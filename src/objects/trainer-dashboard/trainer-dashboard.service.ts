import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';
import { WorkoutStatsService } from '../workout-session/workout-stats.service';
import type {
  TrainerAlert,
  TrainerDashboardRow,
  TrainerWeightTrend,
} from './trainer-dashboard.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** No session in this many days is worth mentioning… */
const IDLE_INFO_DAYS = 7;
/** …and in this many, worth acting on. */
const IDLE_WARN_DAYS = 10;
/** Weight is only called "stalled" over a span at least this long. */
const STALL_MIN_SPAN_DAYS = 21;
/** Movement smaller than this over that span is noise, not progress. */
const STALL_MAX_CHANGE_KG = 0.5;
/** How far back the weight comparison looks for a starting point. */
const WEIGHT_WINDOW_DAYS = 56;
/** The window adherence is measured over — the same one the client's own dashboard uses. */
const ADHERENCE_WINDOW_DAYS = 30;

interface UserRow {
  _id: Types.ObjectId;
  fullName?: string;
  email?: string;
  avatarUrl?: string | null;
}

interface SessionAggRow {
  _id: Types.ObjectId;
  lastWorkoutAt: Date;
  total: number;
  last7: number;
  last14: number;
  last30: number;
  daysTrainedLast30: (string | null)[];
}

interface WeightWindowRow {
  _id: Types.ObjectId;
  firstKg: number;
  firstAt: Date;
  lastKg: number;
  lastAt: Date;
  count: number;
}

interface WeightTotalRow {
  _id: Types.ObjectId;
  count: number;
}

interface PlanRow {
  userId: Types.ObjectId;
  days?: { dayOfWeek?: number }[];
}

/**
 * "Which of my clients needs me this week?"
 *
 * Every panel the trainer could already reach answered a question about *one*
 * client. This answers the only question a roster raises, and it is the reason
 * the answer is a list of alerts rather than a table of numbers: a trainer with
 * ten clients does not read ten columns of statistics, they look for the row
 * that changed.
 *
 * Two rules shape the whole class:
 *
 * 1. **Absence of data is never an alert about the training.** A client with
 *    one weigh-in is not "stalled", and a client with two sessions is not
 *    "fatigued" — both are "ask me later". Every threshold below carries a
 *    minimum-evidence clause, and `null` is used wherever a number would lie.
 *
 * 2. **The roster costs a fixed number of queries.** The obvious shape — loop
 *    the clients, ask the existing per-user services — is four round trips per
 *    client, so a coach with twenty clients pays eighty on one page load. The
 *    counts come from three aggregations keyed by `userId` instead, and the
 *    only per-client call left is the fatigue signal, which is skipped for
 *    anyone whose recent session count already guarantees `insufficient`.
 */
@Injectable()
export class TrainerDashboardService {
  private readonly logger = new Logger(TrainerDashboardService.name);

  constructor(
    @InjectModel('User')
    private readonly userModel: Model<unknown>,
    @InjectModel('WorkoutSession')
    private readonly sessionModel: Model<unknown>,
    @InjectModel('PhysicalData')
    private readonly physicalDataModel: Model<unknown>,
    @InjectModel('TrainingPlan')
    private readonly trainingPlanModel: Model<unknown>,
    private readonly trainerAccess: TrainerAccessService,
    private readonly workoutStats: WorkoutStatsService,
  ) {}

  /** One row per client who has accepted this trainer, worst first. */
  async getOverview(trainerId: string): Promise<TrainerDashboardRow[]> {
    // The roster is the accepted connections, not `User.trainerId` and not
    // "every user" — a revoked connection drops off this screen the moment it
    // is revoked, because it is the same source the permission guard reads.
    const clientIds = await this.trainerAccess.listClientIds(trainerId);
    if (clientIds.length === 0) return [];

    const objectIds = clientIds.map((id) => new Types.ObjectId(id));
    const now = Date.now();

    const [users, sessionRows, weightWindowRows, weightTotalRows, planRows] =
      await Promise.all([
        this.userModel
          .find({ _id: { $in: objectIds } })
          .select('fullName email avatarUrl')
          .lean<UserRow[]>()
          .exec(),
        this.aggregateSessions(objectIds, now),
        this.aggregateWeightWindow(objectIds, now),
        this.aggregateWeightTotals(objectIds),
        this.trainingPlanModel
          .find({ userId: { $in: objectIds }, isActive: true })
          .select('userId days.dayOfWeek')
          .lean<PlanRow[]>()
          .exec(),
      ]);

    const sessionsBy = this.byId(sessionRows);
    const weightWindowBy = this.byId(weightWindowRows);
    const weightTotalBy = this.byId(weightTotalRows);

    const plansBy = new Map<string, PlanRow[]>();
    for (const plan of planRows) {
      const key = plan.userId.toString();
      plansBy.set(key, [...(plansBy.get(key) ?? []), plan]);
    }

    const rows = await Promise.all(
      users.map((user) =>
        this.buildRow({
          user,
          sessions: sessionsBy.get(user._id.toString()) ?? null,
          weightWindow: weightWindowBy.get(user._id.toString()) ?? null,
          weightTotal: weightTotalBy.get(user._id.toString())?.count ?? 0,
          plans: plansBy.get(user._id.toString()) ?? [],
          now,
        }),
      ),
    );

    this.logger.debug(
      `Overview for trainer ${trainerId}: ${rows.length} clients, ` +
        `${rows.filter((row) => row.alerts.length > 0).length} with alerts`,
    );

    return rows.sort(compareBySeverity);
  }

  // ─── the row ──────────────────────────────────────────────────

  private async buildRow(input: {
    user: UserRow;
    sessions: SessionAggRow | null;
    weightWindow: WeightWindowRow | null;
    weightTotal: number;
    plans: PlanRow[];
    now: number;
  }): Promise<TrainerDashboardRow> {
    const { user, sessions, weightWindow, weightTotal, plans, now } = input;
    const clientId = user._id.toString();

    const lastWorkoutAt = sessions?.lastWorkoutAt
      ? new Date(sessions.lastWorkoutAt)
      : null;
    const daysSinceLastWorkout = lastWorkoutAt
      ? Math.floor((now - lastWorkoutAt.getTime()) / DAY_MS)
      : null;

    const weight = this.buildWeightTrend(weightWindow);
    const adherencePercent = this.buildAdherencePercent(
      plans,
      sessions?.daysTrainedLast30 ?? [],
      now,
    );

    // Skipped when the last fortnight cannot possibly clear the signal's own
    // floor of two recent sessions — the answer would be `insufficient`, and
    // this saves a query per idle client to be told so.
    const fatigue =
      (sessions?.last14 ?? 0) >= 2
        ? (await this.workoutStats.getFatigueSignal(clientId)).level
        : 'insufficient';

    const row: TrainerDashboardRow = {
      clientId,
      fullName: user.fullName ?? '',
      email: user.email ?? '',
      avatarUrl: user.avatarUrl ?? null,
      lastWorkoutAt,
      daysSinceLastWorkout,
      sessionsLast7: sessions?.last7 ?? 0,
      sessionsLast30: sessions?.last30 ?? 0,
      totalSessions: sessions?.total ?? 0,
      adherencePercent,
      fatigue,
      weight,
      totalMeasurements: weightTotal,
      hasActivePlan: plans.length > 0,
      alerts: [],
    };

    row.alerts = this.buildAlerts(row, weightWindow);
    return row;
  }

  // ─── alerts ───────────────────────────────────────────────────

  private buildAlerts(
    row: TrainerDashboardRow,
    weightWindow: WeightWindowRow | null,
  ): TrainerAlert[] {
    const alerts: TrainerAlert[] = [];

    if (row.totalSessions === 0) {
      // Deliberately not `missed_workouts`: nothing was missed, nothing ever
      // started. The two need different words from the trainer.
      alerts.push({ code: 'never_trained', severity: 'warn' });
    } else if (row.daysSinceLastWorkout !== null) {
      if (row.daysSinceLastWorkout >= IDLE_WARN_DAYS) {
        alerts.push({
          code: 'missed_workouts',
          severity: 'warn',
          since: row.lastWorkoutAt,
        });
      } else if (row.daysSinceLastWorkout >= IDLE_INFO_DAYS) {
        alerts.push({
          code: 'missed_workouts',
          severity: 'info',
          since: row.lastWorkoutAt,
        });
      }
    }

    if (row.fatigue === 'deload') {
      alerts.push({ code: 'deload_suggested', severity: 'warn' });
    }

    if (!row.hasActivePlan) {
      alerts.push({ code: 'no_active_plan', severity: 'warn' });
    }

    if (row.totalMeasurements === 0) {
      alerts.push({ code: 'no_measurements', severity: 'info' });
    } else if (this.isStalled(row.weight)) {
      alerts.push({
        code: 'weight_stalled',
        severity: 'info',
        since: weightWindow ? new Date(weightWindow.firstAt) : null,
      });
    }

    return alerts.sort((a, b) => severityRank(b) - severityRank(a));
  }

  /**
   * Two weigh-ins three weeks apart that land within half a kilo of each other.
   *
   * Both clauses matter. Without the span, a Tuesday and a Wednesday weighing
   * the same would be called a plateau — which is just what a body does. And
   * with fewer than two points there is no change to measure at all, which is
   * why this returns false rather than treating a single weigh-in as zero
   * change.
   */
  private isStalled(weight: TrainerWeightTrend | null): boolean {
    if (!weight || weight.measurements < 2) return false;
    return (
      weight.spanDays >= STALL_MIN_SPAN_DAYS &&
      Math.abs(weight.changeKg) < STALL_MAX_CHANGE_KG
    );
  }

  // ─── derived figures ──────────────────────────────────────────

  private buildWeightTrend(
    row: WeightWindowRow | null,
  ): TrainerWeightTrend | null {
    if (!row) return null;

    const firstAt = new Date(row.firstAt);
    const lastAt = new Date(row.lastAt);

    return {
      latestKg: row.lastKg,
      latestAt: lastAt,
      changeKg: Number((row.lastKg - row.firstKg).toFixed(2)),
      spanDays: Math.round((lastAt.getTime() - firstAt.getTime()) / DAY_MS),
      measurements: row.count,
    };
  }

  /**
   * The same arithmetic `WorkoutStatsService.buildAdherence` does, over rows
   * the aggregation already returned rather than the client's whole log.
   *
   * Kept identical on purpose — including counting planned days with
   * `getDay()` in server-local time and the day key in UTC — because a trainer
   * who sees 60% while the client sees 55% on their own dashboard has found a
   * bug, whichever number is right.
   */
  private buildAdherencePercent(
    plans: PlanRow[],
    daysTrainedLast30: (string | null)[],
    now: number,
  ): number | null {
    const trainingWeekdays = new Set<number>();
    for (const plan of plans) {
      for (const day of plan.days ?? []) {
        if (typeof day.dayOfWeek === 'number') {
          trainingWeekdays.add(day.dayOfWeek);
        }
      }
    }
    if (trainingWeekdays.size === 0) return null;

    let planned = 0;
    for (let i = 0; i < ADHERENCE_WINDOW_DAYS; i++) {
      const day = new Date(now - i * DAY_MS);
      if (trainingWeekdays.has(day.getDay())) planned++;
    }
    if (planned === 0) return null;

    const completed = new Set(daysTrainedLast30.filter(Boolean)).size;
    // Capped: training more often than planned is not >100% adherence.
    return Math.min(100, Math.round((completed / planned) * 100));
  }

  // ─── aggregations ─────────────────────────────────────────────

  private async aggregateSessions(
    objectIds: Types.ObjectId[],
    now: number,
  ): Promise<SessionAggRow[]> {
    const since = (days: number) => new Date(now - days * DAY_MS);

    return this.sessionModel.aggregate<SessionAggRow>([
      { $match: { userId: { $in: objectIds } } },
      {
        $group: {
          _id: '$userId',
          lastWorkoutAt: { $max: '$performedAt' },
          total: { $sum: 1 },
          last7: {
            $sum: { $cond: [{ $gte: ['$performedAt', since(7)] }, 1, 0] },
          },
          last14: {
            $sum: { $cond: [{ $gte: ['$performedAt', since(14)] }, 1, 0] },
          },
          last30: {
            $sum: {
              $cond: [
                { $gte: ['$performedAt', since(ADHERENCE_WINDOW_DAYS)] },
                1,
                0,
              ],
            },
          },
          // Distinct calendar days, not session count: two sessions on one day
          // is one day of adherence. `$dateToString` defaults to UTC, which is
          // exactly what `dayKey()` produces on the client's own dashboard.
          // Out-of-window rows collapse to a single `null`, dropped when the
          // set is read — `$$REMOVE` is only defined for `$project`-family
          // stages and quietly means something else inside an accumulator.
          daysTrainedLast30: {
            $addToSet: {
              $cond: [
                { $gte: ['$performedAt', since(ADHERENCE_WINDOW_DAYS)] },
                {
                  $dateToString: { format: '%Y-%m-%d', date: '$performedAt' },
                },
                null,
              ],
            },
          },
        },
      },
    ]);
  }

  private async aggregateWeightWindow(
    objectIds: Types.ObjectId[],
    now: number,
  ): Promise<WeightWindowRow[]> {
    return this.physicalDataModel.aggregate<WeightWindowRow>([
      {
        $match: {
          userId: { $in: objectIds },
          dateRecorded: { $gte: new Date(now - WEIGHT_WINDOW_DAYS * DAY_MS) },
        },
      },
      { $sort: { dateRecorded: 1 } },
      {
        $group: {
          _id: '$userId',
          firstKg: { $first: '$weightKg' },
          firstAt: { $first: '$dateRecorded' },
          lastKg: { $last: '$weightKg' },
          lastAt: { $last: '$dateRecorded' },
          count: { $sum: 1 },
        },
      },
    ]);
  }

  /**
   * All-time count, separate from the window above, because "has never weighed
   * in" and "has not weighed in lately" are different sentences to a trainer —
   * and the window alone cannot tell them apart.
   */
  private async aggregateWeightTotals(
    objectIds: Types.ObjectId[],
  ): Promise<WeightTotalRow[]> {
    return this.physicalDataModel.aggregate<WeightTotalRow>([
      { $match: { userId: { $in: objectIds } } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]);
  }

  private byId<T extends { _id: Types.ObjectId }>(rows: T[]): Map<string, T> {
    return new Map(rows.map((row) => [row._id.toString(), row]));
  }
}

function severityRank(alert: TrainerAlert): number {
  return alert.severity === 'warn' ? 2 : 1;
}

/**
 * Worst first: most warnings, then most alerts of any kind, then longest idle.
 * A roster sorted alphabetically makes the trainer do the scanning the screen
 * exists to do for them.
 */
function compareBySeverity(
  a: TrainerDashboardRow,
  b: TrainerDashboardRow,
): number {
  const warns = (row: TrainerDashboardRow) =>
    row.alerts.filter((alert) => alert.severity === 'warn').length;

  if (warns(b) !== warns(a)) return warns(b) - warns(a);
  if (b.alerts.length !== a.alerts.length) {
    return b.alerts.length - a.alerts.length;
  }
  return (b.daysSinceLastWorkout ?? 0) - (a.daysSinceLastWorkout ?? 0);
}
