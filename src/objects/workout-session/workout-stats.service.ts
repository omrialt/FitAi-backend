import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

/**
 * Derived training statistics: personal bests, streaks and adherence.
 *
 * Kept apart from `WorkoutSessionService`, which owns writing and reading the
 * log. This one only asks questions of it.
 *
 * Source of truth is the `WorkoutSession` collection alone — not the legacy
 * history still embedded in training plans. That is deliberate: the backfill
 * script exists to make sessions complete, and duplicating the union logic
 * from progress-stats into every new query would spread a migration detail
 * across the codebase. `ProgressStatsService` reads both only because its
 * numbers were already on screen and must not drop for un-migrated users.
 */

/** One exercise's best recorded set. */
export interface PersonalBest {
  exercise: string;
  weight: number;
  reps: number;
  /** Epley estimate, so 100kg x 5 can be compared against 110kg x 2. */
  estimatedOneRepMax: number;
  achievedAt: Date;
}

export interface StreakSummary {
  /** Consecutive weeks, counting back from this one, with a workout in them. */
  currentWeeks: number;
  longestWeeks: number;
  /** Distinct days trained, all time. */
  totalWorkoutDays: number;
  lastWorkoutAt: Date | null;
}

export interface AdherenceSummary {
  /** Sessions the active plans called for inside the window. */
  planned: number;
  /** Distinct days actually trained inside the window. */
  completed: number;
  /** 0–100, or null when no active plan makes "planned" meaningful. */
  percent: number | null;
  windowDays: number;
}

export interface WorkoutStats {
  streak: StreakSummary;
  adherence: AdherenceSummary;
  personalBests: PersonalBest[];
}

interface SessionRow {
  performedAt: Date;
  exercises?: {
    name: string;
    sets?: { reps: number; weight: number }[];
  }[];
}

interface PlanRow {
  days?: { dayOfWeek?: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WorkoutStatsService {
  constructor(
    @InjectModel('WorkoutSession')
    private readonly sessionModel: Model<unknown>,
    @InjectModel('TrainingPlan')
    private readonly trainingPlanModel: Model<unknown>,
  ) {}

  async getStats(userId: string, windowDays = 30): Promise<WorkoutStats> {
    if (!isValidObjectId(userId)) {
      return {
        streak: this.emptyStreak(),
        adherence: this.emptyAdherence(windowDays),
        personalBests: [],
      };
    }

    const objectId = new Types.ObjectId(userId);

    // The whole log is read once and reduced in memory. A training log is
    // hundreds of documents, not millions, and three separate aggregations
    // over the same rows would cost more than they save.
    const [sessions, plans] = await Promise.all([
      this.sessionModel
        .find({ userId: objectId })
        .sort({ performedAt: 1 })
        .select('performedAt exercises')
        .lean<SessionRow[]>()
        .exec(),
      this.trainingPlanModel
        .find({ userId: objectId, isActive: true })
        .select('days.dayOfWeek')
        .lean<PlanRow[]>()
        .exec(),
    ]);

    return {
      streak: this.buildStreak(sessions),
      adherence: this.buildAdherence(sessions, plans, windowDays),
      personalBests: this.buildPersonalBests(sessions),
    };
  }

  // ─── streaks ──────────────────────────────────────────────────

  /**
   * Streaks are counted in weeks, not days.
   *
   * A day streak is the wrong unit for strength training: almost every program
   * prescribes rest days, so a day-based counter resets constantly and
   * punishes following the plan. A week counts if it holds at least one
   * workout, which is what "kept it up" actually means here.
   */
  private buildStreak(sessions: SessionRow[]): StreakSummary {
    if (sessions.length === 0) {
      return this.emptyStreak();
    }

    const dayKeys = new Set(sessions.map((s) => this.dayKey(s.performedAt)));
    const weekKeys = [
      ...new Set(sessions.map((s) => this.weekIndex(s.performedAt))),
    ].sort((a, b) => a - b);

    let longest = 1;
    let run = 1;
    for (let i = 1; i < weekKeys.length; i++) {
      run = weekKeys[i] === weekKeys[i - 1] + 1 ? run + 1 : 1;
      if (run > longest) longest = run;
    }

    // The current run is only "current" if it reaches this week or last week —
    // giving the in-progress week a grace period, so the number does not drop
    // to zero every Monday morning before the first session.
    const thisWeek = this.weekIndex(new Date());
    const lastTrainedWeek = weekKeys[weekKeys.length - 1];
    let current = 0;
    if (thisWeek - lastTrainedWeek <= 1) {
      current = 1;
      for (let i = weekKeys.length - 1; i > 0; i--) {
        if (weekKeys[i] === weekKeys[i - 1] + 1) current++;
        else break;
      }
    }

    return {
      currentWeeks: current,
      longestWeeks: longest,
      totalWorkoutDays: dayKeys.size,
      lastWorkoutAt: new Date(sessions[sessions.length - 1].performedAt),
    };
  }

  // ─── adherence ────────────────────────────────────────────────

  /**
   * Planned versus done over a rolling window.
   *
   * "Planned" is how many training days the active plans place inside the
   * window: a plan with three weekly training days over 30 days plans roughly
   * 12–13 sessions. Counting occurrences per weekday rather than multiplying
   * by four keeps a partial final week honest.
   */
  private buildAdherence(
    sessions: SessionRow[],
    plans: PlanRow[],
    windowDays: number,
  ): AdherenceSummary {
    const since = new Date(Date.now() - windowDays * DAY_MS);

    const completed = new Set(
      sessions
        .filter((s) => new Date(s.performedAt) >= since)
        .map((s) => this.dayKey(s.performedAt)),
    ).size;

    const trainingWeekdays = new Set<number>();
    for (const plan of plans) {
      for (const day of plan.days ?? []) {
        if (typeof day.dayOfWeek === 'number') {
          trainingWeekdays.add(day.dayOfWeek);
        }
      }
    }

    if (trainingWeekdays.size === 0) {
      return {
        planned: 0,
        completed,
        // No active plan means there is nothing to be adherent to. Reporting
        // 0% would read as a failure; null lets the UI say "no active plan".
        percent: null,
        windowDays,
      };
    }

    let planned = 0;
    for (let i = 0; i < windowDays; i++) {
      const day = new Date(Date.now() - i * DAY_MS);
      if (trainingWeekdays.has(day.getDay())) planned++;
    }

    return {
      planned,
      completed,
      // Capped: training more often than planned is not >100% adherence.
      percent:
        planned === 0
          ? null
          : Math.min(100, Math.round((completed / planned) * 100)),
      windowDays,
    };
  }

  // ─── personal bests ───────────────────────────────────────────

  /**
   * The best set per exercise, ranked by estimated one-rep max rather than raw
   * weight — otherwise a heavy single always beats a genuinely harder set of
   * five, and the number stops tracking strength.
   */
  private buildPersonalBests(sessions: SessionRow[]): PersonalBest[] {
    const best = new Map<string, PersonalBest>();

    for (const session of sessions) {
      const at = new Date(session.performedAt);
      for (const exercise of session.exercises ?? []) {
        for (const set of exercise.sets ?? []) {
          // A set with no load or no reps carries no strength information.
          if (!set.weight || !set.reps) continue;

          const e1rm = this.epley(set.weight, set.reps);
          const held = best.get(exercise.name);
          if (held && held.estimatedOneRepMax >= e1rm) continue;

          best.set(exercise.name, {
            exercise: exercise.name,
            weight: set.weight,
            reps: set.reps,
            estimatedOneRepMax: e1rm,
            achievedAt: at,
          });
        }
      }
    }

    return [...best.values()].sort(
      (a, b) => b.estimatedOneRepMax - a.estimatedOneRepMax,
    );
  }

  /** Epley: 1RM ≈ w x (1 + reps/30). Rounded to a tenth; it is an estimate. */
  private epley(weight: number, reps: number): number {
    return Math.round(weight * (1 + reps / 30) * 10) / 10;
  }

  // ─── helpers ──────────────────────────────────────────────────

  private dayKey(date: Date | string): string {
    return new Date(date).toISOString().slice(0, 10);
  }

  /** Whole weeks since the epoch — adjacent weeks differ by exactly one. */
  private weekIndex(date: Date | string): number {
    return Math.floor(new Date(date).getTime() / (7 * DAY_MS));
  }

  private emptyStreak(): StreakSummary {
    return {
      currentWeeks: 0,
      longestWeeks: 0,
      totalWorkoutDays: 0,
      lastWorkoutAt: null,
    };
  }

  private emptyAdherence(windowDays: number): AdherenceSummary {
    return { planned: 0, completed: 0, percent: null, windowDays };
  }
}
