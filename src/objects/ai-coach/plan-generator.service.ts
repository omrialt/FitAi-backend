import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { AnthropicService } from '../../common/anthropic/anthropic.service';
import { ExerciseService } from '../exercise/exercise.service';
import { WorkoutStatsService } from '../workout-session/workout-stats.service';
import type { TrainingPlan } from '../training-plan/training-plan.schema';
import { MUSCLE_GROUPS, EQUIPMENT } from '../exercise/exercise.schema';

/**
 * A training plan written for one person's goal, equipment and constraints.
 *
 * This is the Tier 1 item that genuinely needed a model, and the reason is
 * worth stating because three of the others did not. The periodization
 * templates cover "give me 5/3/1" — a question with a known answer. This
 * covers "I have two dumbbells, a bad shoulder, four evenings a week, and I
 * want to get stronger", which is a different programme for every person who
 * asks and is not in any table.
 *
 * **The model picks from the catalogue; it does not invent exercises.** Every
 * slug it returns is validated against what the app actually ships, and an
 * unknown one is dropped rather than written into a plan. This is the same
 * grounding decision as the food parser: the model does the part that needs
 * judgement — which lifts, in what order, at what volume, avoiding what — and
 * the app supplies the facts. A hallucinated "Reverse Cable Hack Squat" in a
 * user's Monday would be indistinguishable from a real exercise they had not
 * heard of, which is precisely why it must not be possible.
 *
 * Injuries are handled by exclusion, never by advice. The prompt refuses to
 * diagnose, treat, or reason about a condition; it is told only to avoid
 * loading the named area. Anything more is medical advice from a fitness app.
 */

const MAX_DAYS = 6;
const MAX_EXERCISES_PER_DAY = 8;

const generatedPlanSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  days: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        exercises: z
          .array(
            z.object({
              slug: z.string().min(2).max(80),
              sets: z.number().int().min(1).max(10),
              reps: z.number().int().min(1).max(100),
            }),
          )
          .min(1)
          .max(MAX_EXERCISES_PER_DAY),
      }),
    )
    .min(1)
    .max(MAX_DAYS),
});

export type GeneratedPlan = z.infer<typeof generatedPlanSchema>;

const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A short name for the programme.' },
    description: {
      type: 'string',
      description:
        'Two or three sentences on what this programme is and who it suits.',
    },
    difficulty: {
      type: 'string',
      enum: ['beginner', 'intermediate', 'advanced'],
    },
    days: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_DAYS,
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'What this day trains, e.g. "Push" or "פלג גוף עליון".',
          },
          exercises: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_EXERCISES_PER_DAY,
            items: {
              type: 'object',
              properties: {
                slug: {
                  type: 'string',
                  description:
                    'A slug from the supplied catalogue. Never invent one.',
                },
                sets: { type: 'integer', minimum: 1, maximum: 10 },
                reps: { type: 'integer', minimum: 1, maximum: 100 },
              },
              required: ['slug', 'sets', 'reps'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'exercises'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'description', 'difficulty', 'days'],
  additionalProperties: false,
};

export interface GeneratePlanRequest {
  userId: string;
  goal: 'strength' | 'hypertrophy' | 'fat_loss' | 'general';
  daysPerWeek: number;
  /** Restricts the catalogue the model is shown, so it cannot suggest a barbell to someone without one. */
  equipment?: (typeof EQUIPMENT)[number][];
  /** Areas to avoid loading. Never interpreted as a condition to treat. */
  avoid?: (typeof MUSCLE_GROUPS)[number][];
  experience?: 'beginner' | 'intermediate' | 'advanced';
  language?: string;
  weekdays?: number[];
}

export interface GenerateResult {
  plan: Partial<TrainingPlan> | null;
  /** Slugs the model returned that the catalogue does not have. Empty is the expectation. */
  droppedSlugs: string[];
  tokensUsed: number;
}

const DEFAULT_WEEKDAYS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

@Injectable()
export class PlanGeneratorService {
  private readonly logger = new Logger(PlanGeneratorService.name);

  constructor(
    private readonly anthropic: AnthropicService,
    private readonly exercises: ExerciseService,
    private readonly stats: WorkoutStatsService,
  ) {}

  get enabled(): boolean {
    return this.anthropic.enabled;
  }

  async generate(request: GeneratePlanRequest): Promise<GenerateResult> {
    if (!this.enabled) {
      return { plan: null, droppedSlugs: [], tokensUsed: 0 };
    }

    const hebrew = (request.language ?? 'he').startsWith('he');
    const days = Math.min(Math.max(request.daysPerWeek, 1), MAX_DAYS);

    // The catalogue the model is allowed to choose from, narrowed to what the
    // user actually has. Filtering here rather than asking the model to
    // respect a constraint means a barbell programme for someone with only
    // dumbbells is not a prompt-following failure — it is unrepresentable.
    const catalogue = await this.availableExercises(request.equipment);
    if (catalogue.length === 0) {
      return { plan: null, droppedSlugs: [], tokensUsed: 0 };
    }

    const bySlug = new Map(catalogue.map((entry) => [entry.slug, entry]));

    const result = await this.anthropic.complete({
      label: 'plan-generation',
      jsonSchema: PLAN_JSON_SCHEMA,
      parser: generatedPlanSchema,
      maxTokens: 8000,
      effort: 'medium',
      system: this.systemPrompt(hebrew),
      prompt: this.userPrompt(request, days, catalogue, hebrew),
    });

    if (!result) return { plan: null, droppedSlugs: [], tokensUsed: 0 };

    const { plan, droppedSlugs } = this.materialise(
      result.data,
      request,
      bySlug,
      hebrew,
    );

    if (droppedSlugs.length > 0) {
      // Worth a log line rather than a silent drop: if this is ever non-empty
      // it means the constrained-output schema is not holding, and the fix is
      // in the prompt, not in the user's plan.
      this.logger.warn(
        `Plan generation returned ${droppedSlugs.length} unknown slug(s): ${droppedSlugs.join(', ')}`,
      );
    }

    return { plan, droppedSlugs, tokensUsed: result.tokensUsed };
  }

  private async availableExercises(
    equipment?: (typeof EQUIPMENT)[number][],
  ): Promise<{ slug: string; nameEn: string; nameHe: string; primaryMuscle: string; equipment: string }[]> {
    if (!equipment || equipment.length === 0) {
      return (await this.exercises.search({ limit: 100 })) as never;
    }

    // Bodyweight is always available — someone listing "dumbbell" owns
    // dumbbells and a floor, and excluding push-ups would be pedantic.
    const wanted = new Set<string>([...equipment, 'bodyweight']);
    const all = await this.exercises.search({ limit: 100 });

    return all.filter((entry) => wanted.has(entry.equipment)) as never;
  }

  private systemPrompt(hebrew: boolean): string {
    return [
      'You are a strength coach writing a training programme for one person.',
      '',
      'You are given a catalogue of exercises. Every exercise you use MUST be one of',
      'their slugs, copied exactly. Never invent a slug and never modify one — an',
      'exercise the app does not have cannot be shown to the user, and a plausible',
      'name they have not heard of is indistinguishable from a real one.',
      '',
      'Rules:',
      '- Respect the number of training days exactly.',
      '- Do not include any exercise that loads an area the user asked to avoid,',
      '  as a primary or secondary muscle. Do not comment on the injury, name a',
      '  condition, suggest treatment or rehabilitation, or say anything about',
      '  recovery. Avoid the area and say nothing else about it.',
      '- Order each day so compound lifts come before isolation work.',
      '- Volume should suit the stated experience: fewer sets for a beginner.',
      '- Do not repeat the same exercise twice in one day.',
      `- Write the title, description and day names in ${hebrew ? 'Hebrew' : 'English'}.`,
    ].join('\n');
  }

  private userPrompt(
    request: GeneratePlanRequest,
    days: number,
    catalogue: { slug: string; nameEn: string; primaryMuscle: string; equipment: string }[],
    hebrew: boolean,
  ): string {
    const lines = [
      `Goal: ${request.goal}`,
      `Training days per week: ${days}`,
      `Experience: ${request.experience ?? 'beginner'}`,
    ];

    if (request.avoid?.length) {
      lines.push(`Do not load: ${request.avoid.join(', ')}`);
    }

    lines.push(
      '',
      'Available exercises (slug | name | primary muscle | equipment):',
      ...catalogue.map(
        (entry) =>
          `${entry.slug} | ${entry.nameEn} | ${entry.primaryMuscle} | ${entry.equipment}`,
      ),
    );

    return lines.join('\n');
  }

  /**
   * Turns the model's answer into a plan document.
   *
   * Every slug is looked up, and an unknown one is dropped. This is the second
   * of the two guards — the first is that the model was only shown slugs that
   * exist — and it is here because a constrained-output schema constrains the
   * *shape* of a string, never its contents. A day left with no exercises after
   * dropping is removed entirely rather than written empty.
   *
   * Weights are left at 0: the plan schema requires `targetWeight`, and a
   * model has no idea what this person lifts. The session screen renders 0 as
   * a field to fill in, with the plate calculator beside it — and the overload
   * coach will have a real number after the first session.
   */
  private materialise(
    generated: GeneratedPlan,
    request: GeneratePlanRequest,
    bySlug: Map<string, { slug: string; nameEn: string; nameHe: string; primaryMuscle: string }>,
    hebrew: boolean,
  ): { plan: Partial<TrainingPlan> | null; droppedSlugs: string[] } {
    const droppedSlugs: string[] = [];

    const days = generated.days
      .map((day) => {
        const exercises = day.exercises
          .map((exercise) => {
            const entry = bySlug.get(exercise.slug);
            if (!entry) {
              droppedSlugs.push(exercise.slug);
              return null;
            }

            return {
              name: hebrew ? entry.nameHe : entry.nameEn,
              muscleGroup: entry.primaryMuscle,
              type: 'regular' as const,
              supersetGroupId: null,
              sets: Array.from({ length: exercise.sets }, () => ({
                targetReps: exercise.reps,
                targetWeight: 0,
                history: [] as [],
              })),
            };
          })
          .filter((exercise): exercise is NonNullable<typeof exercise> => exercise !== null);

        return { name: day.name, exercises };
      })
      .filter((day) => day.exercises.length > 0);

    if (days.length === 0) return { plan: null, droppedSlugs };

    const weekdays =
      request.weekdays?.length === days.length
        ? request.weekdays
        : DEFAULT_WEEKDAYS[days.length] ?? days.map((_, i) => i % 7);

    return {
      plan: {
        userId: request.userId,
        title: generated.title,
        description: generated.description,
        difficulty: generated.difficulty,
        days: days.map((day, index) => ({
          dayName: day.name,
          dayOfWeek: weekdays[index],
          exercises: day.exercises,
        })),
        isActive: true,
        programType: 'fixedDays',
        focus: request.goal,
        startDate: new Date(),
      },
      droppedSlugs,
    };
  }
}
