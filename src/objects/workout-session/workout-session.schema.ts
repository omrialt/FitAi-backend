import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

/**
 * A workout that actually happened.
 *
 * Until now the only record of a performed set lived at
 * `TrainingPlan.days[].exercises[].sets[].history[]` — inside the plan
 * document. That made the plan both the intent and the record, with
 * consequences that are not obvious until you hit them:
 *
 *   - a workout that deviated from the plan had nowhere to be written, which
 *     is how training actually goes;
 *   - editing or deleting a plan destroyed the history attached to it;
 *   - sharing deep-clones a plan and forks its history into two copies;
 *   - "how many workouts in the last 30 days" meant unwinding every plan
 *     document in the collection;
 *   - documents grow without bound against Mongo's 16MB ceiling.
 *
 * A session is an immutable-ish event: it references the plan it came from but
 * does not depend on it, so deleting the plan leaves the training log intact.
 * `planTitle` and `dayName` are denormalised for exactly that reason.
 */

export const sessionSourceSchema = z.enum(['app', 'migration', 'import']);

export const performedSetSchema = z.object({
  reps: z
    .number({ invalid_type_error: 'Reps must be a number' })
    .int()
    .nonnegative(),
  weight: z
    .number({ invalid_type_error: 'Weight must be a number' })
    .nonnegative(),
  /** Rate of perceived exertion, 1–10. Optional: not every logger uses it. */
  rpe: z.number().min(1).max(10).optional(),
});

export const sessionExerciseSchema = z.object({
  name: z.string({ required_error: 'Exercise name is required' }),
  muscleGroup: z.string().optional(),
  notes: z.string().optional(),
  sets: z.array(performedSetSchema).default([]),
});

export const workoutSessionSchema = z.object({
  userId: z.union([z.string(), z.object({}).passthrough()]),
  /** Optional on purpose — an unplanned workout is still a workout. */
  planId: z
    .union([z.string(), z.object({}).passthrough()])
    .nullable()
    .optional(),
  planTitle: z.string().optional(),
  dayName: z.string().optional(),
  performedAt: z.date(),
  durationMinutes: z.number().int().positive().optional(),
  notes: z.string().optional(),
  exercises: z.array(sessionExerciseSchema).default([]),
  source: sessionSourceSchema.default('app'),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type WorkoutSession = z.infer<typeof workoutSessionSchema>;
export type SessionExercise = z.infer<typeof sessionExerciseSchema>;
export type PerformedSet = z.infer<typeof performedSetSchema>;
export type SessionSource = z.infer<typeof sessionSourceSchema>;

const PerformedSetMongooseSchema = {
  reps: { type: Number, required: true, min: 0 },
  weight: { type: Number, required: true, min: 0 },
  rpe: { type: Number, min: 1, max: 10 },
};

const SessionExerciseMongooseSchema = {
  name: { type: String, required: true },
  muscleGroup: { type: String },
  notes: { type: String },
  sets: { type: [PerformedSetMongooseSchema], default: [] },
};

export const WorkoutSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'TrainingPlan', default: null },
    // Kept alongside planId so a deleted plan does not turn the log into rows
    // of "(unknown)".
    planTitle: { type: String },
    dayName: { type: String },
    performedAt: { type: Date, required: true },
    durationMinutes: { type: Number, min: 1 },
    notes: { type: String },
    exercises: { type: [SessionExerciseMongooseSchema], default: [] },
    source: {
      type: String,
      enum: ['app', 'migration', 'import'],
      default: 'app',
    },
  },
  { timestamps: true, validateBeforeSave: true },
);

// The query this collection exists to make cheap: one user's sessions in a
// date window, newest first.
WorkoutSessionSchema.index({ userId: 1, performedAt: -1 });
WorkoutSessionSchema.index({ planId: 1 });
WorkoutSessionSchema.index({ 'exercises.name': 1 });

/**
 * Makes the backfill re-runnable. A migrated session is uniquely identified by
 * (user, plan, day, moment); the partial filter keeps the constraint off
 * sessions logged in the app, where two genuine entries at the same second are
 * unlikely but not something to reject.
 */
WorkoutSessionSchema.index(
  { userId: 1, planId: 1, dayName: 1, performedAt: 1 },
  {
    unique: true,
    partialFilterExpression: { source: 'migration' },
  },
);

WorkoutSessionSchema.pre('save', function (next) {
  const result = workoutSessionSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

export type WorkoutSessionDocument = HydratedDocument<WorkoutSession>;
export type WorkoutSessionModel = Model<WorkoutSessionDocument>;
