import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define the Zod schema for validation
export const exercisePerformanceSchema = z.object({
  userId: z.string({
    required_error: 'User ID is required',
    invalid_type_error: 'User ID must be a string',
  }),
  exerciseId: z.string({
    required_error: 'Exercise ID is required',
    invalid_type_error: 'Exercise ID must be a string',
  }),
  trainingPlanId: z.string().optional(),
  trainingDayName: z.string({
    required_error: 'Training day name is required',
    invalid_type_error: 'Training day name must be a string',
  }),
  setIndex: z
    .number({
      required_error: 'Set index is required',
      invalid_type_error: 'Set index must be a number',
    })
    .int()
    .nonnegative(),
  weight: z
    .number({
      required_error: 'Weight is required',
      invalid_type_error: 'Weight must be a number',
    })
    .nonnegative('Weight must be non-negative'),
  reps: z
    .number({
      required_error: 'Reps are required',
      invalid_type_error: 'Reps must be a number',
    })
    .int()
    .positive('Reps must be positive'),
  timestamp: z.date({
    required_error: 'Timestamp is required',
    invalid_type_error: 'Timestamp must be a valid date',
  }),
  notes: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create types from Zod schema
export type ExercisePerformance = z.infer<typeof exercisePerformanceSchema>;

// Define Mongoose schema
export const ExercisePerformanceSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    exerciseId: { type: String, required: true },
    trainingPlanId: {
      type: Schema.Types.ObjectId,
      ref: 'TrainingPlan',
    },
    trainingDayName: { type: String, required: true },
    setIndex: { type: Number, required: true, min: 0 },
    weight: { type: Number, required: true, min: 0 },
    reps: { type: Number, required: true, min: 1 },
    timestamp: { type: Date, required: true },
    notes: { type: String },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

// Add indexes for efficient querying
ExercisePerformanceSchema.index({ userId: 1, exerciseId: 1, timestamp: -1 });
ExercisePerformanceSchema.index({ trainingPlanId: 1 });
ExercisePerformanceSchema.index({ userId: 1 });
ExercisePerformanceSchema.index({ exerciseId: 1 });
ExercisePerformanceSchema.index({ timestamp: -1 });
ExercisePerformanceSchema.index({ userId: 1, timestamp: -1 });

// Add validation middleware
ExercisePerformanceSchema.pre('save', function (next) {
  const result = exercisePerformanceSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

// Type for a hydrated document
export type ExercisePerformanceDocument = HydratedDocument<ExercisePerformance>;

// Type for the model
export type ExercisePerformanceModel = Model<ExercisePerformanceDocument>;