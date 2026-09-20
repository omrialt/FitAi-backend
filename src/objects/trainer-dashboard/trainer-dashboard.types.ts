/**
 * The shape of the trainer's roster overview.
 *
 * Every alert is a **code**, never a sentence. The same choice
 * `FatigueSignal.reasons` already makes, and for the same reason: the wording
 * belongs to the client, which renders it in the user's language, and a
 * Hebrew string baked into a service is a string that can never be translated.
 */

export type TrainerAlertCode =
  /** No session in a week or more. `since` carries the last one. */
  | 'missed_workouts'
  /** Accepted the invite and has never logged a single session. */
  | 'never_trained'
  /** Two or more weigh-ins, three weeks apart or more, going nowhere. */
  | 'weight_stalled'
  /** Never weighed in at all — a gap in the record, not in the training. */
  | 'no_measurements'
  /** `WorkoutStatsService.getFatigueSignal` returned `deload`. */
  | 'deload_suggested'
  /** No active training plan, so there is nothing to adhere to. */
  | 'no_active_plan';

/**
 * `warn` means the trainer has something to do now; `info` is worth knowing.
 * Nothing here is an error — a client is not a failed request.
 */
export type TrainerAlertSeverity = 'warn' | 'info';

export interface TrainerAlert {
  code: TrainerAlertCode;
  severity: TrainerAlertSeverity;
  /** When the condition started, where that is knowable. */
  since?: Date | null;
}

/** Weight movement over the comparison window, or `null` when unknowable. */
export interface TrainerWeightTrend {
  latestKg: number;
  latestAt: Date;
  /** Latest minus the earliest weigh-in inside the window. */
  changeKg: number;
  /** Days between those two weigh-ins — the evidence behind `changeKg`. */
  spanDays: number;
  measurements: number;
}

export interface TrainerDashboardRow {
  clientId: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;

  lastWorkoutAt: Date | null;
  /** `null` when they have never trained — not `0`, which would read as today. */
  daysSinceLastWorkout: number | null;
  sessionsLast7: number;
  sessionsLast30: number;
  totalSessions: number;

  /** `null` when no active plan makes "planned" a meaningful denominator. */
  adherencePercent: number | null;
  fatigue: 'insufficient' | 'ok' | 'watch' | 'deload';

  /** `null` when there are not two weigh-ins to compare. */
  weight: TrainerWeightTrend | null;
  totalMeasurements: number;
  hasActivePlan: boolean;

  /** Empty when nothing needs saying. Sorted warn-first. */
  alerts: TrainerAlert[];
}
