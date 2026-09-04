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

export type FatigueLevel = 'insufficient' | 'ok' | 'watch' | 'deload';

export interface FatigueSignal {
  level: FatigueLevel;
  /** Machine-readable reasons, so the client picks its own wording. */
  reasons: (
    | 'volume_dropping'
    | 'effort_climbing'
    | 'frequency_dropping'
    | 'load_stalled'
  )[];
  /** Percent change in weekly volume, recent window vs the baseline before it. */
  volumeChangePercent: number | null;
  /** Mean RPE recently, and before. `null` until the user reports any. */
  recentRpe: number | null;
  baselineRpe: number | null;
  recentSessions: number;
  baselineSessions: number;
}

/** One session's best effort on one exercise — a point on the strength curve. */
export interface ExerciseHistoryPoint {
  /** ISO day, not a timestamp: the curve's x-axis is the calendar. */
  date: string;
  weight: number;
  reps: number;
  estimatedOneRepMax: number;
  /** Weight x reps across every set of that exercise that day. */
  volume: number;
  sets: number;
  /** True on the day this became the best e1RM to date. */
  isPersonalBest: boolean;
}

export interface ExerciseHistory {
  exercise: string;
  points: ExerciseHistoryPoint[];
  /** Every exercise the user has logged, so the picker offers real options. */
  availableExercises: string[];
}

interface SessionRow {
  performedAt: Date;
  exercises?: {
    name: string;
    sets?: { reps: number; weight: number; rpe?: number }[];
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

  // ─── fatigue ──────────────────────────────────────────────────

  /**
   * Whether the recent block looks like accumulating fatigue.
   *
   * Compares the last two weeks against the four before them, on three
   * signals that mean different things together than apart: volume falling,
   * perceived effort rising, and sessions being missed. Any one of them alone
   * is a normal week — a deload week is *supposed* to drop volume, and a busy
   * fortnight explains a missed session. Two together is a pattern.
   *
   * The first return value is the important one. `insufficient` is not a
   * failure state and not an empty state: with a handful of sessions there is
   * no baseline to compare against, and inventing a verdict from three data
   * points is exactly how a feature like this loses the user's trust on first
   * contact. RPE only began being collected on 2026-08-29, so this stays
   * honest about how much it actually knows.
   */
  async getFatigueSignal(userId: string): Promise<FatigueSignal> {
    if (!isValidObjectId(userId)) return this.emptyFatigue();

    const since = new Date(Date.now() - 42 * DAY_MS);
    const sessions = await this.sessionModel
      .find({
        userId: new Types.ObjectId(userId),
        performedAt: { $gte: since },
      })
      .sort({ performedAt: 1 })
      .select('performedAt exercises')
      .lean<SessionRow[]>()
      .exec();

    const recentFrom = Date.now() - 14 * DAY_MS;
    const recent = sessions.filter(
      (s) => new Date(s.performedAt).getTime() >= recentFrom,
    );
    const baseline = sessions.filter(
      (s) => new Date(s.performedAt).getTime() < recentFrom,
    );

    // Two sessions in each window is the floor for a comparison to mean
    // anything at all; below that the answer is "ask me later".
    if (recent.length < 2 || baseline.length < 4) {
      return {
        ...this.emptyFatigue(),
        recentSessions: recent.length,
        baselineSessions: baseline.length,
      };
    }

    // Per week, not per window: the baseline is twice as long, and comparing
    // raw totals would report a 50% "drop" for identical training.
    const recentVolumePerWeek = this.totalVolume(recent) / 2;
    const baselineVolumePerWeek = this.totalVolume(baseline) / 4;
    const recentPerWeek = recent.length / 2;
    const baselinePerWeek = baseline.length / 4;

    const volumeChangePercent =
      baselineVolumePerWeek > 0
        ? Math.round(
            ((recentVolumePerWeek - baselineVolumePerWeek) /
              baselineVolumePerWeek) *
              100,
          )
        : null;

    const recentRpe = this.meanRpe(recent);
    const baselineRpe = this.meanRpe(baseline);

    const reasons: FatigueSignal['reasons'] = [];

    if (volumeChangePercent !== null && volumeChangePercent <= -15) {
      reasons.push('volume_dropping');
    }
    // Half a point on a ten-point scale is about the smallest move that is not
    // noise in self-reported effort.
    if (
      recentRpe !== null &&
      baselineRpe !== null &&
      recentRpe - baselineRpe >= 0.5
    ) {
      reasons.push('effort_climbing');
    }
    if (recentPerWeek < baselinePerWeek - 0.5) {
      reasons.push('frequency_dropping');
    }
    // Working harder for the same or less work is the classic signature.
    if (
      recentRpe !== null &&
      baselineRpe !== null &&
      recentRpe - baselineRpe >= 0.3 &&
      volumeChangePercent !== null &&
      volumeChangePercent <= 5
    ) {
      reasons.push('load_stalled');
    }

    const level: FatigueLevel =
      reasons.length >= 2 ? 'deload' : reasons.length === 1 ? 'watch' : 'ok';

    return {
      level,
      reasons,
      volumeChangePercent,
      recentRpe,
      baselineRpe,
      recentSessions: recent.length,
      baselineSessions: baseline.length,
    };
  }

  private totalVolume(sessions: SessionRow[]): number {
    let total = 0;
    for (const session of sessions) {
      for (const exercise of session.exercises ?? []) {
        for (const set of exercise.sets ?? []) {
          total += (set.weight || 0) * (set.reps || 0);
        }
      }
    }
    return total;
  }

  /** `null` rather than 0 when nobody reported RPE — absent is not "easy". */
  private meanRpe(sessions: SessionRow[]): number | null {
    let sum = 0;
    let count = 0;

    for (const session of sessions) {
      for (const exercise of session.exercises ?? []) {
        for (const set of exercise.sets ?? []) {
          if (typeof set.rpe === 'number') {
            sum += set.rpe;
            count += 1;
          }
        }
      }
    }

    return count === 0 ? null : Math.round((sum / count) * 10) / 10;
  }

  private emptyFatigue(): FatigueSignal {
    return {
      level: 'insufficient',
      reasons: [],
      volumeChangePercent: null,
      recentRpe: null,
      baselineRpe: null,
      recentSessions: 0,
      baselineSessions: 0,
    };
  }

  // ─── strength curve ───────────────────────────────────────────

  /**
   * One exercise's progression over time, one point per day trained.
   *
   * The personal-bests card answers "what is my best squat"; this answers the
   * question that actually drives training decisions — "am I still getting
   * stronger, or have I been stuck since May". A single number cannot show a
   * plateau.
   *
   * Collapsed per day rather than per set, because five sets on one day are one
   * data point about that day's strength, not five. The day's best set by
   * estimated 1RM represents it, for the same reason personal bests rank that
   * way: otherwise a heavy double and a hard set of eight are incomparable.
   *
   * `availableExercises` rides along on every call so the picker can be built
   * from what the user has actually logged, without a second round trip on a
   * screen that has just opened.
   */
  async getExerciseHistory(
    userId: string,
    exercise?: string,
    windowDays?: number,
  ): Promise<ExerciseHistory> {
    if (!isValidObjectId(userId)) {
      return { exercise: exercise ?? '', points: [], availableExercises: [] };
    }

    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    // The window bounds the curve, not the exercise list: narrowing to 90 days
    // must not make an exercise disappear from the picker that selected it.
    if (windowDays) {
      filter.performedAt = { $gte: new Date(Date.now() - windowDays * DAY_MS) };
    }

    const [sessions, allNames] = await Promise.all([
      this.sessionModel
        .find(filter)
        .sort({ performedAt: 1 })
        .select('performedAt exercises')
        .lean<SessionRow[]>()
        .exec(),
      this.sessionModel
        .distinct('exercises.name', { userId: new Types.ObjectId(userId) })
        .exec() as Promise<string[]>,
    ]);

    const availableExercises = [...allNames]
      .filter((name): name is string => typeof name === 'string' && !!name)
      .sort((a, b) => a.localeCompare(b));

    // No exercise asked for means "the one worth looking at first": whatever
    // has the most logged days, which is the user's main lift.
    const target = exercise ?? this.mostLoggedExercise(sessions);
    if (!target) {
      return { exercise: '', points: [], availableExercises };
    }

    return {
      exercise: target,
      points: this.buildExercisePoints(sessions, target),
      availableExercises,
    };
  }

  /** Case-insensitive: "Bench Press" and "bench press" are one exercise. */
  private matches(name: string, target: string): boolean {
    return name.trim().toLowerCase() === target.trim().toLowerCase();
  }

  private mostLoggedExercise(sessions: SessionRow[]): string | null {
    // Keyed case-insensitively but carrying the name as the user first wrote
    // it, so the picker shows "Bench Press" rather than "bench press".
    const seen = new Map<string, { name: string; days: Set<string> }>();

    for (const session of sessions) {
      const day = this.dayKey(session.performedAt);

      for (const exercise of session.exercises ?? []) {
        if (!exercise.name) continue;

        const key = exercise.name.trim().toLowerCase();
        const entry = seen.get(key) ?? { name: exercise.name, days: new Set() };
        entry.days.add(day);
        seen.set(key, entry);
      }
    }

    let winner: string | null = null;
    let best = 0;
    for (const entry of seen.values()) {
      if (entry.days.size > best) {
        best = entry.days.size;
        winner = entry.name;
      }
    }

    return winner;
  }

  private buildExercisePoints(
    sessions: SessionRow[],
    target: string,
  ): ExerciseHistoryPoint[] {
    const byDay = new Map<string, ExerciseHistoryPoint>();

    for (const session of sessions) {
      const day = this.dayKey(session.performedAt);

      for (const exercise of session.exercises ?? []) {
        if (!exercise.name || !this.matches(exercise.name, target)) continue;

        for (const set of exercise.sets ?? []) {
          if (!set.weight || !set.reps) continue;

          const e1rm = this.epley(set.weight, set.reps);
          const held = byDay.get(day);

          if (!held) {
            byDay.set(day, {
              date: day,
              weight: set.weight,
              reps: set.reps,
              estimatedOneRepMax: e1rm,
              volume: set.weight * set.reps,
              sets: 1,
              isPersonalBest: false,
            });
            continue;
          }

          held.volume += set.weight * set.reps;
          held.sets += 1;
          if (e1rm > held.estimatedOneRepMax) {
            held.weight = set.weight;
            held.reps = set.reps;
            held.estimatedOneRepMax = e1rm;
          }
        }
      }
    }

    const points = [...byDay.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    // Marked in one forward pass: a day is a PR only against what came before
    // it, so the flags read as history rather than as hindsight.
    let ceiling = 0;
    for (const point of points) {
      point.volume = Math.round(point.volume * 10) / 10;
      if (point.estimatedOneRepMax > ceiling) {
        point.isPersonalBest = true;
        ceiling = point.estimatedOneRepMax;
      }
    }

    return points;
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

  /**
   * Which calendar week a date falls in. Adjacent weeks differ by exactly one.
   *
   * Weeks start on Sunday, in the viewer's own timezone. This used to be
   * `floor(t / 7 days)`, whole weeks since the Unix epoch, which is simpler
   * and wrong in a way nothing on screen revealed: **1 January 1970 was a
   * Thursday**, so every user's training week silently rolled over on Thursday
   * morning. Someone who trained on Wednesday and opened the app on Thursday
   * saw their streak read zero, because the grace period — "this week or last
   * week" — measured those weeks from Thursday. The number was wrong two days
   * out of every seven and right the rest of the time, which is how it
   * survived six revisions of the gap analysis and a passing test suite: the
   * test that catches it only fails when it is *run* on a Wednesday or a
   * Thursday. It was found on 2026-09-03, a Thursday.
   *
   * Sunday because the rest of the app already counts that way — `dayOfWeek`
   * on a training plan is 0-6 with 0 = Sunday, and the product is Hebrew-first,
   * where the working week starts on Sunday.
   *
   * Built from local midnight rather than UTC so the boundary is the one the
   * user actually experiences. `Math.round` rather than `floor` absorbs the
   * one-hour DST shift between two consecutive local Sundays, which would
   * otherwise drop two different weeks into one bucket twice a year.
   */
  private weekIndex(date: Date | string): number {
    const at = new Date(date);
    const startOfWeek = new Date(
      at.getFullYear(),
      at.getMonth(),
      at.getDate() - at.getDay(),
    );
    return Math.round(startOfWeek.getTime() / (7 * DAY_MS));
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
