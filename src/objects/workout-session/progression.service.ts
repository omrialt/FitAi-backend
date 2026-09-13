import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import { WorkoutStatsService, FatigueSignal } from './workout-stats.service';
import { ExerciseService } from '../exercise/exercise.service';
import type { Equipment } from '../exercise/exercise.schema';
import { topWeight } from './set-math';

/**
 * What to do next session: add load, add a rep, or back off.
 *
 * Two features live here because they are two halves of one question. The
 * overload coach answers "push", the deload prescription answers "stop
 * pushing", and a system that can only say the first is the one currently
 * shipped — the fatigue signal has been computed since round 6 and nothing
 * has ever acted on it. A coach that never says "take a week" is not being
 * optimistic, it is being useless at the moment it matters most.
 *
 * **There is no AI in this file.** Every earlier revision of the gap analysis
 * filed progressive overload under the AI tier, and it does not belong there
 * for the same reason exercise substitution did not: the answer is determined
 * by the numbers already in the log. Double progression is a rule, not a
 * judgement, and a rule that runs offline, costs nothing, and returns the same
 * answer twice is strictly better than a prompt that does neither. The AI in
 * this project should be spent where the answer is genuinely not computable.
 */

/** How much load to add, by what the equipment can actually be loaded with. */
const INCREMENT_KG: Record<Equipment, number> = {
  // Two 1.25kg plates, the smallest pair most gyms own.
  barbell: 2.5,
  // Dumbbells come in fixed jumps; below ~10kg they are usually 1kg apart and
  // above it 2kg, but the pair is what changes, so this is per-hand doubled.
  dumbbell: 2,
  // Selectorised stacks are typically 5kg here.
  machine: 5,
  cable: 2.5,
  kettlebell: 4,
  // Adding load is not the progression axis for these; reps are.
  bodyweight: 0,
  band: 0,
  other: 2.5,
};

/** When the catalogue does not recognise the name the user typed. */
const DEFAULT_INCREMENT_KG = 2.5;

/**
 * Above this, "you hit your reps" stops being a reason to add weight.
 *
 * RPE 9 means roughly one rep left in the tank. Adding load on top of a set
 * that already felt like that is how a good week becomes a stalled month, and
 * it is the single thing a naive double-progression implementation gets wrong.
 */
const EFFORT_CEILING = 9;

export type OverloadAction = 'add_weight' | 'add_reps' | 'hold';

export type OverloadReason =
  | 'range_topped'
  | 'range_not_topped'
  | 'effort_high'
  | 'deloading';

export interface OverloadSuggestion {
  exercise: string;
  /** ISO day of the last session containing it. */
  lastPerformedAt: string;
  lastTopSet: { weight: number; reps: number; sets: number };
  /** Inferred from what the user actually does, not prescribed by us. */
  repRange: { min: number; max: number };
  action: OverloadAction;
  reason: OverloadReason;
  suggested: { weight: number; reps: number; sets: number };
  incrementKg: number;
  /** From the catalogue; `null` when the typed name matched nothing. */
  equipment: Equipment | null;
  /** Mean RPE of the last session's sets, `null` when none was reported. */
  lastRpe: number | null;
}

export interface OverloadPlan {
  suggestions: OverloadSuggestion[];
  /**
   * True when the fatigue signal says back off. Every suggestion is then
   * `hold`, because the two features must not contradict each other on the
   * same screen.
   */
  deloadRecommended: boolean;
}

export interface DeloadExercise {
  exercise: string;
  from: { weight: number; sets: number; reps: number };
  to: { weight: number; sets: number; reps: number };
}

export interface DeloadPrescription {
  recommended: boolean;
  /** Mirrors the fatigue level so the client does not have to fetch both. */
  level: FatigueSignal['level'];
  reasons: FatigueSignal['reasons'];
  /** Percent of current working load to use, e.g. 80. */
  loadPercent: number;
  /** Percent of current working sets to keep, e.g. 60. */
  volumePercent: number;
  durationDays: number;
  exercises: DeloadExercise[];
}

interface SessionRow {
  performedAt: Date;
  exercises?: {
    name: string;
    sets?: {
      reps: number;
      weight: number;
      rpe?: number;
      drops?: { reps: number; weight: number }[];
    }[];
  }[];
}

/** One exercise on one day, reduced to the numbers a decision needs. */
interface DayRecord {
  day: string;
  at: Date;
  name: string;
  topWeight: number;
  /** Reps of every set performed at `topWeight`. */
  repsAtTop: number[];
  totalSets: number;
  rpe: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Long enough for a rep range to emerge, short enough to be current. */
const WINDOW_DAYS = 90;

/** Below this there is no pattern, only a data point. */
const MIN_DAYS_LOGGED = 2;

@Injectable()
export class ProgressionService {
  constructor(
    @InjectModel('WorkoutSession')
    private readonly sessionModel: Model<unknown>,
    private readonly stats: WorkoutStatsService,
    private readonly exercises: ExerciseService,
  ) {}

  // ─── progressive overload ─────────────────────────────────────

  /**
   * What to do next, per exercise, from what was actually logged.
   *
   * Double progression: work up the rep range at a fixed load, and when the
   * top of the range is hit on every set, add the smallest load the equipment
   * allows and drop back down the range. It is the standard rule because it
   * only ever asks for one new thing at a time.
   *
   * The rep range is *inferred*, not prescribed. Ranges live on the training
   * plan as `targetReps`, but plans are optional here and often stale, while
   * the log is neither. Taking the range from what someone has actually been
   * doing means the suggestion is grounded in the same numbers they can see on
   * their own history screen — and it means nobody has to fill in a form
   * before the feature works.
   *
   * When the fatigue signal says deload, everything returns `hold`. This is
   * the coupling that makes both features honest: an overload coach that keeps
   * saying "add weight" while a deload banner sits above it has taught the
   * user to ignore one of them, and it will be the banner.
   */
  async getOverloadPlan(
    userId: string,
    exercise?: string,
    limit = 8,
  ): Promise<OverloadPlan> {
    if (!isValidObjectId(userId)) {
      return { suggestions: [], deloadRecommended: false };
    }

    const [sessions, fatigue] = await Promise.all([
      this.recentSessions(userId),
      this.stats.getFatigueSignal(userId),
    ]);

    const deloading = fatigue.level === 'deload';
    const byExercise = this.groupByExercise(sessions);

    const suggestions: OverloadSuggestion[] = [];

    for (const [, records] of byExercise) {
      if (records.length < MIN_DAYS_LOGGED) continue;

      const latest = records[records.length - 1];
      if (exercise && !this.matches(latest.name, exercise)) continue;

      suggestions.push(
        await this.suggestFor(records, latest, deloading),
      );
    }

    // Most recently trained first: the lift you did yesterday is the one you
    // are about to repeat, and the one a suggestion is actionable for.
    suggestions.sort(
      (a, b) => b.lastPerformedAt.localeCompare(a.lastPerformedAt),
    );

    return {
      suggestions: suggestions.slice(0, Math.max(1, limit)),
      deloadRecommended: deloading,
    };
  }

  private async suggestFor(
    records: DayRecord[],
    latest: DayRecord,
    deloading: boolean,
  ): Promise<OverloadSuggestion> {
    const repRange = this.inferRepRange(records);
    const catalogued = await this.exercises.resolveByName(latest.name);
    const equipment = catalogued?.equipment ?? null;
    const incrementKg = equipment
      ? INCREMENT_KG[equipment]
      : DEFAULT_INCREMENT_KG;

    const setsAtTop = latest.repsAtTop.length;
    const toppedOut =
      setsAtTop > 0 && latest.repsAtTop.every((reps) => reps >= repRange.max);
    const tooHard = latest.rpe !== null && latest.rpe >= EFFORT_CEILING;

    let action: OverloadAction;
    let reason: OverloadReason;

    if (deloading) {
      action = 'hold';
      reason = 'deloading';
    } else if (toppedOut && tooHard) {
      // Reps are there but the effort says the load is already at its
      // ceiling. Repeating the session is the honest answer; the next
      // attempt at the same weight will feel easier or it will not.
      action = 'hold';
      reason = 'effort_high';
    } else if (toppedOut) {
      action = incrementKg > 0 ? 'add_weight' : 'add_reps';
      reason = 'range_topped';
    } else {
      action = 'add_reps';
      reason = 'range_not_topped';
    }

    const suggested = this.applyAction(action, latest, repRange, incrementKg);

    return {
      exercise: latest.name,
      lastPerformedAt: latest.day,
      lastTopSet: {
        weight: latest.topWeight,
        reps: Math.max(...latest.repsAtTop, 0),
        sets: setsAtTop,
      },
      repRange,
      action,
      reason,
      suggested,
      incrementKg,
      equipment,
      lastRpe: latest.rpe,
    };
  }

  private applyAction(
    action: OverloadAction,
    latest: DayRecord,
    repRange: { min: number; max: number },
    incrementKg: number,
  ): { weight: number; reps: number; sets: number } {
    const sets = Math.max(1, latest.repsAtTop.length);
    const lowestRep = Math.min(...latest.repsAtTop);

    if (action === 'add_weight') {
      return {
        // Back to the bottom of the range at the new load — that is what
        // makes the jump repeatable rather than a one-rep max attempt.
        weight: round(latest.topWeight + incrementKg),
        reps: repRange.min,
        sets,
      };
    }

    if (action === 'add_reps') {
      return {
        weight: latest.topWeight,
        // One more than the weakest set, capped at the top of the range. The
        // weakest set is where the work is; the strongest is already fine.
        reps: Math.min(lowestRep + 1, repRange.max),
        sets,
      };
    }

    return {
      weight: latest.topWeight,
      reps: lowestRep,
      sets,
    };
  }

  /**
   * The rep range this person actually trains in, from the last 90 days.
   *
   * A single-rep-count history has no range to speak of, so it gets a window
   * of two above it — enough for double progression to have somewhere to go
   * without inventing a training philosophy for someone.
   */
  private inferRepRange(records: DayRecord[]): { min: number; max: number } {
    const reps = records.flatMap((record) => record.repsAtTop);
    if (reps.length === 0) return { min: 5, max: 8 };

    const min = Math.min(...reps);
    const max = Math.max(...reps);

    return max > min ? { min, max } : { min, max: min + 2 };
  }

  // ─── deload ───────────────────────────────────────────────────

  /**
   * What backing off would actually look like, in kilos and sets.
   *
   * The fatigue signal has existed since round 6 and says one of four words.
   * A user reading "deload" on their dashboard still has to decide what that
   * means for Monday, and most will decide it means nothing. This turns the
   * word into a session they can perform.
   *
   * `watch` gets a prescription too, marked `recommended: false`. It is the
   * difference between an alarm and an option: the numbers are there to look
   * at, and nothing on the screen insists.
   *
   * Percentages rather than a fixed drop because a deload is proportional to
   * what is being deloaded from. 80% of load and 60% of sets is the
   * conventional light week — enough stimulus to keep the movement, little
   * enough to actually recover.
   */
  async getDeloadPrescription(userId: string): Promise<DeloadPrescription> {
    const fatigue = await this.stats.getFatigueSignal(userId);

    const empty: DeloadPrescription = {
      recommended: false,
      level: fatigue.level,
      reasons: fatigue.reasons,
      loadPercent: 100,
      volumePercent: 100,
      durationDays: 0,
      exercises: [],
    };

    // `insufficient` is not `ok`. Prescribing rest from a signal that admits
    // it does not know anything is exactly the filler the fatigue detector
    // was written to avoid.
    if (fatigue.level === 'insufficient' || fatigue.level === 'ok') {
      return empty;
    }

    const watching = fatigue.level === 'watch';
    const loadPercent = watching ? 90 : 80;
    const volumePercent = watching ? 80 : 60;

    const sessions = await this.recentSessions(userId, 21);
    const byExercise = this.groupByExercise(sessions);

    const exercises: DeloadExercise[] = [];

    for (const [, records] of byExercise) {
      const latest = records[records.length - 1];
      const sets = Math.max(1, latest.repsAtTop.length);
      const reps = Math.max(...latest.repsAtTop, 0);
      if (!latest.topWeight || !reps) continue;

      exercises.push({
        exercise: latest.name,
        from: { weight: latest.topWeight, sets, reps },
        to: {
          weight: roundToIncrement(latest.topWeight * (loadPercent / 100)),
          // Never below one set: a deload is a lighter week, not a week off,
          // and dropping a lift to zero loses the movement pattern.
          sets: Math.max(1, Math.round(sets * (volumePercent / 100))),
          reps,
        },
      });
    }

    exercises.sort((a, b) => b.from.weight - a.from.weight);

    return {
      recommended: fatigue.level === 'deload',
      level: fatigue.level,
      reasons: fatigue.reasons,
      loadPercent,
      volumePercent,
      durationDays: 7,
      exercises: exercises.slice(0, 8),
    };
  }

  // ─── shared reading ───────────────────────────────────────────

  private async recentSessions(
    userId: string,
    windowDays = WINDOW_DAYS,
  ): Promise<SessionRow[]> {
    return this.sessionModel
      .find({
        userId: new Types.ObjectId(userId),
        performedAt: { $gte: new Date(Date.now() - windowDays * DAY_MS) },
      })
      .sort({ performedAt: 1 })
      .select('performedAt exercises')
      .lean<SessionRow[]>()
      .exec();
  }

  /**
   * Collapses the log into one record per exercise per day.
   *
   * Same reasoning as the strength curve: five sets on one day are one
   * statement about that day, not five. Keyed case-insensitively but carrying
   * the name as the user wrote it, so the suggestion says "Bench Press" and
   * not "bench press".
   */
  private groupByExercise(sessions: SessionRow[]): Map<string, DayRecord[]> {
    const byKey = new Map<string, Map<string, DayRecord>>();

    for (const session of sessions) {
      const at = new Date(session.performedAt);
      const day = at.toISOString().slice(0, 10);

      for (const exercise of session.exercises ?? []) {
        if (!exercise.name) continue;

        const key = exercise.name.trim().toLowerCase();
        const days = byKey.get(key) ?? new Map<string, DayRecord>();
        byKey.set(key, days);

        const record =
          days.get(day) ??
          ({
            day,
            at,
            name: exercise.name,
            topWeight: 0,
            repsAtTop: [],
            totalSets: 0,
            rpe: null,
          } satisfies DayRecord);

        let rpeSum = 0;
        let rpeCount = 0;

        for (const set of exercise.sets ?? []) {
          if (!set.reps) continue;
          record.totalSets += 1;

          if (typeof set.rpe === 'number') {
            rpeSum += set.rpe;
            rpeCount += 1;
          }

          // `topWeight`, not `set.weight`, so this reads as a deliberate
          // strength figure: the drops below it are lighter by definition and
          // must not be mistaken for the working weight.
          const weight = topWeight(set);
          if (weight > record.topWeight) {
            // A heavier set redefines the working load, so the reps counted
            // at the old one no longer describe it.
            record.topWeight = weight;
            record.repsAtTop = [set.reps];
          } else if (weight === record.topWeight) {
            record.repsAtTop.push(set.reps);
          }
        }

        if (rpeCount > 0) {
          const existing = record.rpe;
          const mean = rpeSum / rpeCount;
          record.rpe =
            existing === null ? round(mean) : round((existing + mean) / 2);
        }

        days.set(day, record);
      }
    }

    const out = new Map<string, DayRecord[]>();
    for (const [key, days] of byKey) {
      const records = [...days.values()]
        .filter((record) => record.repsAtTop.length > 0)
        .sort((a, b) => a.day.localeCompare(b.day));

      if (records.length > 0) out.set(key, records);
    }

    return out;
  }

  private matches(name: string, target: string): boolean {
    return name.trim().toLowerCase() === target.trim().toLowerCase();
  }
}

/** One decimal. These are kilos on a bar, not currency. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * To the nearest 2.5kg, and never to zero.
 *
 * A deload that prescribes 68.4kg is a deload nobody performs, because that
 * is not a number a barbell makes. Rounding down keeps it a deload — rounding
 * to nearest could hand back load the week was meant to remove.
 */
function roundToIncrement(value: number): number {
  if (value <= 0) return 0;
  return Math.max(2.5, Math.floor(value / 2.5) * 2.5);
}
