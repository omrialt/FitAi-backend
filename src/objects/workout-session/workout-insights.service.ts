import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { setVolume, topReps, topWeight } from './set-math';

/**
 * The questions the history page asks of the log that are about *kinds* of
 * training rather than about one day: how is "Upper A" going compared with
 * "Lower", and within the chest work, is the bench moving while the incline
 * press is not.
 *
 * Two groupings, both taken from what a session already stores:
 *
 *   - **workout type** is the session's `dayName` — the name the day was
 *     performed under. It is denormalised onto every session precisely so it
 *     survives the plan being edited or deleted, which also makes it the one
 *     stable way to say "the same workout";
 *   - **exercise type** is the exercise's `muscleGroup`, which the logger
 *     copies from the plan on every set.
 *
 * Like `WorkoutStatsService`, the log is read once and reduced in memory. The
 * same rule about drops applies: they count toward volume and never toward
 * a strength figure (see `set-math.ts`).
 */

export type ExerciseTrend = 'new' | 'improving' | 'stalled' | 'declining';

/** How one exercise has moved across the sessions it appears in. */
export interface ExerciseProgress {
  name: string;
  muscleGroup: string | null;
  /** Distinct days it was trained. */
  sessions: number;
  firstE1rm: number;
  bestE1rm: number;
  lastE1rm: number;
  /** Last against first, in percent. `null` with a single session. */
  changePercent: number | null;
  trend: ExerciseTrend;
  lastPerformedAt: string;
  /** The top set behind `bestE1rm`, as the user would write it. */
  bestSet: { weight: number; reps: number };
}

export interface WorkoutTypeInsight {
  /** The session's `dayName`, or `null` for sessions logged without one. */
  dayName: string | null;
  planTitles: string[];
  sessions: number;
  firstPerformedAt: string;
  lastPerformedAt: string;
  /** Sessions per week across the span this type has been trained. */
  perWeek: number;
  avgDurationMinutes: number | null;
  avgVolume: number;
  lastVolume: number;
  /**
   * Mean volume of the recent half of these sessions against the earlier half
   * (latest against previous when there are only two or three). `null` with
   * a single session — there is nothing to compare.
   */
  volumeTrendPercent: number | null;
  avgRpe: number | null;
  exercises: ExerciseProgress[];
  mostImproved: string | null;
  stalled: string[];
}

export interface WorkoutTypesSummary {
  types: WorkoutTypeInsight[];
}

export interface ExerciseComparisonPoint {
  date: string;
  estimatedOneRepMax: number;
  weight: number;
  reps: number;
  volume: number;
}

export interface ComparedExercise extends ExerciseProgress {
  points: ExerciseComparisonPoint[];
}

export interface ExerciseComparison {
  muscleGroup: string | null;
  /** Every muscle group in the log, for the picker. All-time. */
  availableMuscleGroups: string[];
  exercises: ComparedExercise[];
}

interface SessionRow {
  performedAt: Date;
  dayName?: string;
  planTitle?: string;
  durationMinutes?: number;
  exercises?: {
    name: string;
    muscleGroup?: string;
    sets?: {
      reps: number;
      weight: number;
      rpe?: number;
      drops?: { reps: number; weight: number }[];
    }[];
  }[];
}

/** One exercise on one day, reduced to what the curves need. */
interface DayPoint extends ExerciseComparisonPoint {
  name: string;
  muscleGroup: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Below this many sessions a trend is a coin toss. "Stalled" needs a run of
 * recent sessions that failed to beat what came before.
 */
const STALL_WINDOW = 3;
/** Movement smaller than this, either way, is noise in an e1RM estimate. */
const IMPROVING_PERCENT = 1;
const DECLINING_PERCENT = -2;

@Injectable()
export class WorkoutInsightsService {
  constructor(
    @InjectModel('WorkoutSession')
    private readonly sessionModel: Model<unknown>,
  ) {}

  // ─── workout types ────────────────────────────────────────────

  async getWorkoutTypes(userId: string): Promise<WorkoutTypesSummary> {
    if (!isValidObjectId(userId)) return { types: [] };

    const sessions = await this.readLog(userId);

    // Keyed case-insensitively ("upper a" is "Upper A") but labelled as the
    // user first wrote it.
    const groups = new Map<
      string,
      { label: string | null; rows: SessionRow[] }
    >();
    for (const session of sessions) {
      const label = session.dayName?.trim() || null;
      const key = label?.toLowerCase() ?? '';
      const group = groups.get(key) ?? { label, rows: [] };
      group.rows.push(session);
      groups.set(key, group);
    }

    const types = [...groups.values()].map(({ label, rows }) =>
      this.describeType(label, rows),
    );

    // Most recently trained first: the type you did last is the one you are
    // most likely to be looking up.
    types.sort((a, b) => b.lastPerformedAt.localeCompare(a.lastPerformedAt));

    return { types };
  }

  private describeType(
    dayName: string | null,
    rows: SessionRow[],
  ): WorkoutTypeInsight {
    // `readLog` sorts oldest first, and grouping preserves that order.
    const first = rows[0];
    const last = rows[rows.length - 1];

    const volumes = rows.map((row) => this.sessionVolume(row));
    const durations = rows
      .map((row) => row.durationMinutes)
      .filter((d): d is number => typeof d === 'number' && d > 0);
    const rpes = rows.flatMap((row) =>
      (row.exercises ?? []).flatMap((exercise) =>
        (exercise.sets ?? [])
          .map((set) => set.rpe)
          .filter((rpe): rpe is number => typeof rpe === 'number'),
      ),
    );

    const spanDays =
      (new Date(last.performedAt).getTime() -
        new Date(first.performedAt).getTime()) /
      DAY_MS;
    // A single week at minimum, or two sessions a day apart would read as
    // "seven a week".
    const weeks = Math.max(1, spanDays / 7);

    const exercises = this.progressFor(this.dayPoints(rows));
    const improving = exercises
      .filter((e) => e.trend === 'improving' && e.changePercent !== null)
      .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));

    return {
      dayName,
      planTitles: [
        ...new Set(
          rows
            .map((row) => row.planTitle?.trim())
            .filter((t): t is string => !!t),
        ),
      ],
      sessions: rows.length,
      firstPerformedAt: new Date(first.performedAt).toISOString(),
      lastPerformedAt: new Date(last.performedAt).toISOString(),
      perWeek: this.round(rows.length / weeks, 1),
      avgDurationMinutes: durations.length
        ? Math.round(this.mean(durations))
        : null,
      avgVolume: Math.round(this.mean(volumes)),
      lastVolume: Math.round(volumes[volumes.length - 1]),
      volumeTrendPercent: this.volumeTrend(volumes),
      avgRpe: rpes.length ? this.round(this.mean(rpes), 1) : null,
      exercises,
      mostImproved: improving[0]?.name ?? null,
      stalled: exercises
        .filter((e) => e.trend === 'stalled')
        .map((e) => e.name),
    };
  }

  private volumeTrend(volumes: number[]): number | null {
    if (volumes.length < 2) return null;

    let before: number;
    let after: number;
    if (volumes.length < 4) {
      before = volumes[volumes.length - 2];
      after = volumes[volumes.length - 1];
    } else {
      // Halves, capped at four each: a trend over the last two months of a
      // workout, not over everything since the account was opened.
      const half = Math.min(4, Math.floor(volumes.length / 2));
      after = this.mean(volumes.slice(-half));
      before = this.mean(volumes.slice(-2 * half, -half));
    }

    if (before <= 0) return null;
    return Math.round(((after - before) / before) * 100);
  }

  // ─── exercise comparison ──────────────────────────────────────

  async getExerciseComparison(
    userId: string,
    muscleGroup?: string,
    windowDays?: number,
  ): Promise<ExerciseComparison> {
    if (!isValidObjectId(userId)) {
      return { muscleGroup: null, availableMuscleGroups: [], exercises: [] };
    }

    // The whole log once; the window is applied below. Reading it twice (once
    // windowed, once for the picker) would cost a second round trip for a list
    // the full read already contains.
    const sessions = await this.readLog(userId);
    const allPoints = this.dayPoints(sessions);

    // Muscle group → distinct exercise names, for the picker and the default.
    const groups = new Map<string, { label: string; names: Set<string> }>();
    for (const point of allPoints) {
      if (!point.muscleGroup) continue;
      const key = point.muscleGroup.toLowerCase();
      const group = groups.get(key) ?? {
        label: point.muscleGroup,
        names: new Set<string>(),
      };
      group.names.add(point.name.toLowerCase());
      groups.set(key, group);
    }

    const availableMuscleGroups = [...groups.values()]
      .map((g) => g.label)
      .sort((a, b) => a.localeCompare(b));

    // No group asked for: the one with the most distinct exercises in it,
    // which is where a comparison has the most to say.
    let target: string | null = muscleGroup?.trim() || null;
    if (!target) {
      let most = 0;
      for (const group of groups.values()) {
        if (group.names.size > most) {
          most = group.names.size;
          target = group.label;
        }
      }
    }
    if (!target) {
      return { muscleGroup: null, availableMuscleGroups, exercises: [] };
    }

    const since = windowDays
      ? new Date(Date.now() - windowDays * DAY_MS).toISOString().slice(0, 10)
      : null;
    const wanted = target.toLowerCase();
    const inGroup = allPoints.filter(
      (p) =>
        p.muscleGroup?.toLowerCase() === wanted && (!since || p.date >= since),
    );

    const progress = this.progressFor(inGroup);
    const exercises: ComparedExercise[] = progress.map((summary) => ({
      ...summary,
      points: inGroup
        .filter((p) => p.name.toLowerCase() === summary.name.toLowerCase())
        .map(({ date, estimatedOneRepMax, weight, reps, volume }) => ({
          date,
          estimatedOneRepMax,
          weight,
          reps,
          volume,
        })),
    }));

    return {
      muscleGroup: groups.get(wanted)?.label ?? target,
      availableMuscleGroups,
      exercises,
    };
  }

  // ─── shared ───────────────────────────────────────────────────

  private readLog(userId: string): Promise<SessionRow[]> {
    return this.sessionModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ performedAt: 1 })
      .select('performedAt dayName planTitle durationMinutes exercises')
      .lean<SessionRow[]>()
      .exec();
  }

  /**
   * One point per exercise per day, oldest first: the best top set by e1RM,
   * and every set's volume (drops included) summed.
   *
   * Per day rather than per session so two sessions of the same lift on one
   * day — a morning and an evening — are one point on the curve, which is how
   * the strength curve already counts them.
   */
  private dayPoints(sessions: SessionRow[]): DayPoint[] {
    const byKey = new Map<string, DayPoint>();

    for (const session of sessions) {
      const date = new Date(session.performedAt).toISOString().slice(0, 10);

      for (const exercise of session.exercises ?? []) {
        if (!exercise.name?.trim()) continue;
        const sets = exercise.sets ?? [];
        if (sets.length === 0) continue;

        const key = `${date}|${exercise.name.trim().toLowerCase()}`;
        const point = byKey.get(key) ?? {
          name: exercise.name.trim(),
          muscleGroup: exercise.muscleGroup?.trim() || null,
          date,
          estimatedOneRepMax: 0,
          weight: 0,
          reps: 0,
          volume: 0,
        };

        for (const set of sets) {
          point.volume += setVolume(set);
          const e1rm = this.epley(topWeight(set), topReps(set));
          if (e1rm > point.estimatedOneRepMax) {
            point.estimatedOneRepMax = e1rm;
            point.weight = topWeight(set);
            point.reps = topReps(set);
          }
        }

        byKey.set(key, point);
      }
    }

    return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Per-exercise progress over the given points, most-trained first. */
  private progressFor(points: DayPoint[]): ExerciseProgress[] {
    const byName = new Map<string, DayPoint[]>();
    for (const point of points) {
      const key = point.name.toLowerCase();
      const list = byName.get(key) ?? [];
      list.push(point);
      byName.set(key, list);
    }

    const out: ExerciseProgress[] = [];
    for (const list of byName.values()) {
      // Bodyweight lifts logged at 0kg have no e1RM to compare; they still
      // appear, as "new" until they carry a load.
      const first = list[0];
      const last = list[list.length - 1];
      let best = first;
      for (const point of list) {
        if (point.estimatedOneRepMax > best.estimatedOneRepMax) best = point;
      }

      const changePercent =
        list.length > 1 && first.estimatedOneRepMax > 0
          ? this.round(
              ((last.estimatedOneRepMax - first.estimatedOneRepMax) /
                first.estimatedOneRepMax) *
                100,
              1,
            )
          : null;

      out.push({
        name: first.name,
        muscleGroup: first.muscleGroup,
        sessions: list.length,
        firstE1rm: first.estimatedOneRepMax,
        bestE1rm: best.estimatedOneRepMax,
        lastE1rm: last.estimatedOneRepMax,
        changePercent,
        trend: this.trendOf(list, changePercent),
        lastPerformedAt: last.date,
        bestSet: { weight: best.weight, reps: best.reps },
      });
    }

    return out.sort(
      (a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name),
    );
  }

  /**
   * "Stalled" is judged on the recent run, not on first-vs-last: a lift that
   * climbed for two months and then sat still for three sessions is stalled
   * now, however good its overall change looks.
   */
  private trendOf(
    list: DayPoint[],
    changePercent: number | null,
  ): ExerciseTrend {
    if (changePercent === null) return 'new';

    if (list.length > STALL_WINDOW) {
      const earlierBest = Math.max(
        ...list.slice(0, -STALL_WINDOW).map((p) => p.estimatedOneRepMax),
      );
      const recentBest = Math.max(
        ...list.slice(-STALL_WINDOW).map((p) => p.estimatedOneRepMax),
      );
      if (recentBest <= earlierBest) {
        return changePercent <= DECLINING_PERCENT ? 'declining' : 'stalled';
      }
    }

    if (changePercent >= IMPROVING_PERCENT) return 'improving';
    if (changePercent <= DECLINING_PERCENT) return 'declining';
    return 'stalled';
  }

  private sessionVolume(session: SessionRow): number {
    let total = 0;
    for (const exercise of session.exercises ?? []) {
      for (const set of exercise.sets ?? []) total += setVolume(set);
    }
    return total;
  }

  /** Epley, as everywhere else in the log. */
  private epley(weight: number, reps: number): number {
    if (weight <= 0 || reps <= 0) return 0;
    return Math.round(weight * (1 + reps / 30) * 10) / 10;
  }

  private mean(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private round(value: number, digits: number): number {
    const f = 10 ** digits;
    return Math.round(value * f) / f;
  }
}
