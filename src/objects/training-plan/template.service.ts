import { BadRequestException, Injectable } from '@nestjs/common';

import {
  PERIODIZATION_TEMPLATES,
  PeriodizationTemplate,
  TemplateSet,
  findTemplate,
} from './periodization-templates';
import type { TrainingPlan } from './training-plan.schema';
import { ExerciseService } from '../exercise/exercise.service';
import { WorkoutStatsService } from '../workout-session/workout-stats.service';

/**
 * Turns a programme template into a training plan the user owns.
 *
 * The output is an ordinary `TrainingPlan`. Nothing here introduces a "template
 * plan" type, a link back to the template, or a sync relationship — the plan is
 * the user's from the moment it is created, and every screen that already edits
 * plans edits this one too. A template is a starting point, not a subscription;
 * the alternative would mean deciding what happens when a user edits day three
 * of a programme that later changes upstream, and nothing about this feature
 * justifies that question.
 *
 * Two things are resolved at creation time rather than stored in the template:
 *
 *   - **Names**, from the catalogue in the user's own language. The template
 *     holds slugs, so a Hebrew user gets a Hebrew plan and a catalogue rename
 *     never strands a template on a name that no longer reads correctly;
 *
 *   - **Weights**, from the user's own log. `5/3/1` prescribes 85% of a max,
 *     which is a number nobody has typed in anywhere — but the estimated 1RM
 *     is already computed for the personal-bests card, so the plan can open
 *     with real loads instead of zeros the user has to fill in before their
 *     first session.
 */

/** Which real weekdays to place the cycle on, when the caller does not say. */
const DEFAULT_WEEKDAYS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

export interface BuildTemplateOptions {
  templateId: string;
  userId: string;
  /** 'he' or anything else; only Hebrew is special-cased. */
  language?: string;
  /**
   * Which weekdays (0 = Sunday) to schedule the cycle on. Length must match
   * the template's day count, or it is ignored in favour of the default.
   */
  weekdays?: number[];
  title?: string;
}

@Injectable()
export class TemplateService {
  constructor(
    private readonly exercises: ExerciseService,
    private readonly stats: WorkoutStatsService,
  ) {}

  /** The catalogue of programmes, for the picker. Days are not sent. */
  list(): Omit<PeriodizationTemplate, 'days'>[] {
    return PERIODIZATION_TEMPLATES.map(({ days: _days, ...rest }) => rest);
  }

  get(id: string): PeriodizationTemplate {
    const template = findTemplate(id);
    if (!template) {
      throw new BadRequestException(`Unknown template "${id}"`);
    }
    return template;
  }

  /**
   * Builds the plan document. Does not save it — the caller owns persistence,
   * so this stays testable without a database and the existing `create` path
   * keeps its validation, its calendar sync and its sharing rules.
   */
  async build(options: BuildTemplateOptions): Promise<Partial<TrainingPlan>> {
    const template = this.get(options.templateId);
    const hebrew = (options.language ?? 'he').startsWith('he');

    // One read for every lift the template mentions, rather than one per
    // exercise per day: PPL names 30 exercises across six days and most of
    // them repeat.
    const slugs = [
      ...new Set(
        template.days.flatMap((day) =>
          day.exercises.map((exercise) => exercise.slug),
        ),
      ),
    ];

    const [catalogue, stats] = await Promise.all([
      Promise.all(slugs.map((slug) => this.exercises.findBySlug(slug))),
      this.stats.getStats(options.userId),
    ]);

    const bySlug = new Map(
      catalogue
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .map((entry) => [entry.slug, entry]),
    );

    // Keyed by lowercase name in both languages, because the log stores
    // whatever the user typed and the template knows only a slug.
    const oneRepMaxByName = new Map(
      stats.personalBests.map((best) => [
        best.exercise.trim().toLowerCase(),
        best.estimatedOneRepMax,
      ]),
    );

    const weekdays = this.resolveWeekdays(template, options.weekdays);

    const days = template.days.map((day, index) => {
      const exercises = day.exercises.map((templateExercise) => {
        const entry = bySlug.get(templateExercise.slug);

        // A template slug missing from the catalogue would be a bug in the
        // shipped data, and there is a test that fails on it. If one ever
        // slips through, the slug itself is a worse name than nothing but a
        // better plan than a crash.
        const name = entry
          ? hebrew
            ? entry.nameHe
            : entry.nameEn
          : templateExercise.slug;

        const oneRepMax = this.findOneRepMax(oneRepMaxByName, name, entry);

        return {
          name,
          muscleGroup: entry?.primaryMuscle ?? '',
          type: 'regular' as const,
          supersetGroupId: null,
          sets: templateExercise.sets.map((set) =>
            this.buildSet(set, oneRepMax),
          ),
        };
      });

      return {
        dayName: hebrew ? day.nameHe : day.nameEn,
        dayOfWeek: weekdays[index],
        exercises,
      };
    });

    return {
      userId: options.userId,
      title:
        options.title ?? (hebrew ? template.nameHe : template.nameEn),
      description: hebrew ? template.descriptionHe : template.descriptionEn,
      days,
      difficulty: template.difficulty,
      isActive: true,
      programType: 'fixedDays',
      focus: template.goal,
      startDate: new Date(),
    };
  }

  /**
   * The user's estimated 1RM for a catalogue exercise, whatever they call it.
   *
   * The log stores free text, so a lookup by canonical name alone is not
   * enough: someone who has been logging "Bench Press" for months has no
   * personal best under "Barbell Bench Press", which is what the catalogue
   * calls it. Matching only the canonical names produced a 5/3/1 plan with
   * real percentages on the squat and press and zeros on the bench and
   * deadlift — from the same log, for no reason the user could see.
   *
   * `aliases` is the field that fixes it, and this is what it was put in the
   * catalogue for: "the spellings people actually type", so the catalogue
   * never has to rename an exercise to be findable. Checked last, after both
   * canonical names, so an exact match always wins over a nickname.
   */
  private findOneRepMax(
    byName: Map<string, number>,
    planName: string,
    entry: { nameEn: string; nameHe: string; aliases?: string[] } | undefined,
  ): number | null {
    const lookup = (value: string | undefined) =>
      value ? byName.get(value.trim().toLowerCase()) : undefined;

    const candidates = [
      planName,
      entry?.nameEn,
      entry?.nameHe,
      ...(entry?.aliases ?? []),
    ];

    for (const candidate of candidates) {
      const found = lookup(candidate);
      if (found !== undefined) return found;
    }

    return null;
  }

  /**
   * One prescribed set, with a real weight where the log can supply one.
   *
   * `targetWeight` is required by the plan schema and cannot be null, so a lift
   * the user has never performed gets 0 — which the session screen already
   * renders as an empty field to fill in. That is the honest answer: guessing a
   * starting weight for a stranger is how a plan gets someone injured, and the
   * plate calculator is right there.
   */
  private buildSet(
    set: TemplateSet,
    oneRepMax: number | null,
  ): { targetReps: number; targetWeight: number; history: [] } {
    if (set.percentOfOneRepMax === null || oneRepMax === null) {
      return { targetReps: set.reps, targetWeight: 0, history: [] };
    }

    const raw = oneRepMax * (set.percentOfOneRepMax / 100);

    return {
      targetReps: set.reps,
      // To the nearest 2.5kg, because that is what a barbell makes.
      targetWeight: Math.max(0, Math.round(raw / 2.5) * 2.5),
      history: [],
    };
  }

  /**
   * Which weekdays the cycle lands on.
   *
   * The template stores a cycle position, not a weekday, so this is the only
   * place a real day of the week gets chosen. A caller-supplied list has to
   * match the template's length exactly — a four-day programme squeezed into
   * two days is not that programme, and silently dropping half of it would be
   * worse than ignoring the request.
   */
  private resolveWeekdays(
    template: PeriodizationTemplate,
    requested?: number[],
  ): number[] {
    const count = template.days.length;

    if (
      requested &&
      requested.length === count &&
      requested.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    ) {
      return requested;
    }

    return DEFAULT_WEEKDAYS[count] ?? template.days.map((_, i) => i % 7);
  }
}
