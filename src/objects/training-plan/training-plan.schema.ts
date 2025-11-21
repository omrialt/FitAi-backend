import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define Zod enums
export const exerciseTypeSchema = z.enum(['regular', 'dropset', 'superset']);
export const difficultySchema = z.enum([
  'beginner',
  'intermediate',
  'advanced',
]);
export const accessLevelSchema = z.enum(['view', 'edit']);
export const objectTypeSchema = z.enum(['trainingPlan', 'nutritionPlan']);

// Define SharedAccessEntry schema
export const sharedAccessEntrySchema = z.object({
  userId: z.string({
    required_error: 'User ID is required for shared access',
    invalid_type_error: 'User ID must be a string',
  }),
  accessLevel: accessLevelSchema,
  objectType: objectTypeSchema,
});

// Define WeightHistoryEntry schema
export const weightHistoryEntrySchema = z.object({
  date: z.date({
    required_error: 'Date is required',
    invalid_type_error: 'Date must be a valid date',
  }),
  weight: z
    .number({
      required_error: 'Weight is required',
      invalid_type_error: 'Weight must be a number',
    })
    .nonnegative(),
  reps: z
    .number({
      required_error: 'Reps are required',
      invalid_type_error: 'Reps must be a number',
    })
    .positive(),
});

// Define ExerciseSet schema
export const exerciseSetSchema = z.object({
  targetReps: z
    .number({
      required_error: 'Target reps are required',
      invalid_type_error: 'Target reps must be a number',
    })
    .positive(),
  targetWeight: z
    .number({
      required_error: 'Target weight is required',
      invalid_type_error: 'Target weight must be a number',
    })
    .nonnegative(),
  performedReps: z
    .number({
      invalid_type_error: 'Performed reps must be a number',
    })
    .positive()
    .optional(),
  performedWeight: z
    .number({
      invalid_type_error: 'Performed weight must be a number',
    })
    .nonnegative()
    .optional(),
  history: z.array(weightHistoryEntrySchema).default([]),
});

// Define Exercise schema
export const exerciseSchema = z.object({
  name: z.string({
    required_error: 'Exercise name is required',
    invalid_type_error: 'Exercise name must be a string',
  }),
  muscleGroup: z.string({
    required_error: 'Muscle group is required',
    invalid_type_error: 'Muscle group must be a string',
  }),
  type: exerciseTypeSchema.default('regular'),
  supersetGroupId: z.string().nullable().default(null),
  notes: z.string().optional(),
  video: z.string().url('Invalid video URL format').optional(),
  sets: z.array(exerciseSetSchema).default([]),
});

// Define TrainingDay schema
export const trainingDaySchema = z.object({
  dayName: z.string({
    required_error: 'Day name is required',
    invalid_type_error: 'Day name must be a string',
  }),
  exercises: z.array(exerciseSchema).default([]),
});

// Define the main TrainingPlan schema
export const trainingPlanSchema = z.object({
  userId: z.string({
    required_error: 'User ID is required',
    invalid_type_error: 'User ID must be a string',
  }),
  trainerId: z.string().optional().nullable(),
  title: z.string({
    required_error: 'Title is required',
    invalid_type_error: 'Title must be a string',
  }),
  description: z.string({
    required_error: 'Description is required',
    invalid_type_error: 'Description must be a string',
  }),
  days: z.array(trainingDaySchema).default([]),
  difficulty: difficultySchema.default('beginner'),
  sharedWith: z.array(z.string()).default([]),
  sharedAccess: z.array(sharedAccessEntrySchema).default([]),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create types from Zod schemas
export type TrainingPlan = z.infer<typeof trainingPlanSchema>;
export type TrainingDay = z.infer<typeof trainingDaySchema>;
export type Exercise = z.infer<typeof exerciseSchema>;
export type ExerciseSet = z.infer<typeof exerciseSetSchema>;
export type WeightHistoryEntry = z.infer<typeof weightHistoryEntrySchema>;
export type ExerciseType = z.infer<typeof exerciseTypeSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export type SharedAccessEntry = z.infer<typeof sharedAccessEntrySchema>;
export type AccessLevel = z.infer<typeof accessLevelSchema>;
export type ObjectType = z.infer<typeof objectTypeSchema>;

// Define Mongoose WeightHistoryEntry schema
const WeightHistoryEntryMongooseSchema = {
  date: { type: Date, required: true },
  weight: { type: Number, required: true, min: 0 },
  reps: { type: Number, required: true, min: 1 },
};

// Define Mongoose ExerciseSet schema
const ExerciseSetMongooseSchema = {
  targetReps: { type: Number, required: true, min: 1 },
  targetWeight: { type: Number, required: true, min: 0 },
  performedReps: { type: Number, min: 1 },
  performedWeight: { type: Number, min: 0 },
  history: {
    type: [WeightHistoryEntryMongooseSchema],
    default: [],
  },
};

// Define Mongoose Exercise schema
const ExerciseMongooseSchema = {
  name: { type: String, required: true },
  muscleGroup: { type: String, required: true },
  type: {
    type: String,
    enum: ['regular', 'dropset', 'superset'],
    default: 'regular',
  },
  supersetGroupId: { type: String, default: null },
  notes: { type: String },
  video: { type: String },
  sets: {
    type: [ExerciseSetMongooseSchema],
    default: [],
  },
};

// Define Mongoose TrainingDay schema
const TrainingDayMongooseSchema = {
  dayName: { type: String, required: true },
  exercises: {
    type: [ExerciseMongooseSchema],
    default: [],
  },
};

// Define main Mongoose TrainingPlan schema
export const TrainingPlanSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    trainerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    title: { type: String, required: true },
    description: { type: String, required: true },
    days: {
      type: [TrainingDayMongooseSchema],
      default: [],
    },
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'beginner',
    },
    sharedWith: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    sharedAccess: {
      type: [
        {
          userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          accessLevel: {
            type: String,
            enum: ['view', 'edit'],
            required: true,
          },
          objectType: {
            type: String,
            enum: ['trainingPlan', 'nutritionPlan'],
            required: true,
          },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

// Add indexes for efficient querying
TrainingPlanSchema.index({ userId: 1 });
TrainingPlanSchema.index({ trainerId: 1 });
TrainingPlanSchema.index({ difficulty: 1 });
TrainingPlanSchema.index({ createdAt: -1 });
TrainingPlanSchema.index({ userId: 1, createdAt: -1 });
TrainingPlanSchema.index({ trainerId: 1, createdAt: -1 });
TrainingPlanSchema.index({ 'days.exercises.name': 'text' });
TrainingPlanSchema.index({ 'days.exercises.muscleGroup': 1 });
TrainingPlanSchema.index({ sharedWith: 1 });
TrainingPlanSchema.index({ 'sharedAccess.userId': 1 });
TrainingPlanSchema.index({ 'sharedAccess.accessLevel': 1 });

// Add validation middleware
TrainingPlanSchema.pre('save', function (next) {
  const result = trainingPlanSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

// Type for a hydrated document
export type TrainingPlanDocument = HydratedDocument<TrainingPlan>;

// Type for the model
export type TrainingPlanModel = Model<TrainingPlanDocument>;
