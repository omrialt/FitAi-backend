import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AlertService } from './alert.service';

/**
 * A single invariant, and whether it currently holds.
 * `count` is whatever the check measured, for the log and the alert body.
 */
export interface ProbeResult {
  name: string;
  ok: boolean;
  count?: number;
  detail: string;
}

/**
 * How old an unverified email signup must be before it counts as stranded.
 * Someone who registered an hour ago and has not clicked the link yet is
 * normal; someone from last week is locked out and not coming back on their
 * own.
 */
const STRANDED_AFTER_DAYS = 3;

/**
 * Periodic checks on things that break quietly.
 *
 * This exists because of a specific incident: a deploy shipped email
 * verification before the backfill that marks existing accounts verified, and
 * three accounts — including the owner's — could not log in. Nothing alerted,
 * because nothing was *erroring*: every one of those requests was a perfectly
 * well-formed 403. Error tracking would not have caught it. Only asking "can
 * the people who should be able to log in actually log in?" catches it, which
 * is what these probes do.
 *
 * Each check is a question about state, not about traffic, so it works fine on
 * serverless where nothing is remembered between requests.
 */
@Injectable()
export class HealthProbeService {
  private readonly logger = new Logger(HealthProbeService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel('User') private readonly userModel: Model<unknown>,
    @InjectModel('TrainingPlan')
    private readonly trainingPlanModel: Model<unknown>,
    private readonly alerts: AlertService,
  ) {}

  /** Run every probe and alert on each one that fails. */
  async runAll(): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];

    for (const check of [
      () => this.checkDatabase(),
      () => this.checkStrandedUnverifiedAccounts(),
      () => this.checkUnmigratedWorkoutHistory(),
    ]) {
      try {
        results.push(await check());
      } catch (error) {
        // A probe that throws is itself a finding — report it rather than
        // letting one failure hide the checks that follow it.
        results.push({
          name: 'probe-error',
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const result of results.filter((r) => !r.ok)) {
      await this.alerts.raise({
        fingerprint: `probe:${result.name}`,
        subject: `Health probe failed: ${result.name}`,
        detail: {
          check: result.name,
          detail: result.detail,
          ...(result.count !== undefined ? { count: result.count } : {}),
          environment:
            process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
        },
      });
    }

    const failed = results.filter((r) => !r.ok).length;
    this.logger.log(
      `Health probes: ${results.length - failed}/${results.length} passing`,
    );

    return results;
  }

  /** Is Mongo actually answering, not merely marked connected? */
  private async checkDatabase(): Promise<ProbeResult> {
    // readyState is the driver's opinion; a ping is the server's.
    const admin = this.connection.db?.admin();
    if (!admin) {
      return {
        name: 'database',
        ok: false,
        detail: 'No database handle on the connection',
      };
    }

    await admin.ping();
    return { name: 'database', ok: true, detail: 'ping ok' };
  }

  /**
   * Accounts that can never log in unaided.
   *
   * This is the incident, generalised: an email-provider account left
   * unverified long past the point anyone would still be clicking the link.
   * Google accounts are excluded — that provider sets the flag at signup, and
   * they are exactly the accounts that survived the incident untouched.
   */
  private async checkStrandedUnverifiedAccounts(): Promise<ProbeResult> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STRANDED_AFTER_DAYS);

    const count = await this.userModel.countDocuments({
      emailVerified: false,
      authProvider: 'email',
      createdAt: { $lt: cutoff },
    });

    return {
      name: 'stranded-unverified-accounts',
      ok: count === 0,
      count,
      detail:
        count === 0
          ? 'no accounts stranded unverified'
          : `${count} email account(s) unverified for more than ${STRANDED_AFTER_DAYS} days — ` +
            'they cannot log in. If these predate the verification flow, run ' +
            '`npm run migrate:email-verified`.',
    };
  }

  /**
   * Embedded workout history that never became a WorkoutSession.
   *
   * The obvious version of this check — "do any plans still contain embedded
   * history?" — is wrong, and measurably so: the backfill deliberately copies
   * rather than moves, so the embedded arrays survive a completed migration
   * and that check would alert forever. Against production it reported 2 plans
   * while the actual number of unmigrated workout-days was 0.
   *
   * This asks the question that matters instead: is there a (plan, day, date)
   * in the old embedded history with no session to match? Once the legacy read
   * branch is gone, any such day is invisible in a user's stats — silently
   * missing workouts, which is exactly the class of bug this codebase has been
   * bitten by before.
   */
  private async checkUnmigratedWorkoutHistory(): Promise<ProbeResult> {
    const result = await this.trainingPlanModel
      .aggregate<{ unmigrated: number }>([
        { $match: { 'days.exercises.sets.history.0': { $exists: true } } },
        { $unwind: '$days' },
        { $unwind: '$days.exercises' },
        { $unwind: '$days.exercises.sets' },
        { $unwind: '$days.exercises.sets.history' },
        {
          // One entry per distinct workout-day, the grain the backfill used.
          $group: {
            _id: {
              planId: '$_id',
              dayName: '$days.dayName',
              day: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$days.exercises.sets.history.date',
                },
              },
            },
          },
        },
        {
          $lookup: {
            from: 'workoutsessions',
            let: {
              p: '$_id.planId',
              d: '$_id.dayName',
              day: '$_id.day',
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$planId', '$$p'] },
                      { $eq: ['$dayName', '$$d'] },
                      {
                        $eq: [
                          {
                            $dateToString: {
                              format: '%Y-%m-%d',
                              date: '$performedAt',
                            },
                          },
                          '$$day',
                        ],
                      },
                    ],
                  },
                },
              },
              // Existence is all this needs; the document itself is not read.
              { $limit: 1 },
            ],
            as: 'session',
          },
        },
        { $match: { session: { $size: 0 } } },
        { $count: 'unmigrated' },
      ])
      .exec();

    const count = result[0]?.unmigrated ?? 0;

    return {
      name: 'unmigrated-workout-history',
      ok: count === 0,
      count,
      detail:
        count === 0
          ? 'every embedded workout-day has a matching session'
          : `${count} workout-day(s) exist only in embedded plan history — ` +
            'run `npm run migrate:workout-sessions` before relying on the ' +
            'WorkoutSession collection alone.',
    };
  }
}
