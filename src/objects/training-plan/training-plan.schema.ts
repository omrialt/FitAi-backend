import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define the Exercise schema
export const exerciseSchema = z.object({
  name: z.string({
    required_error: 'Exercise name is required',
    invalid_type_error: 'Exercise name must be a string',
  }),
  sets: z
    .number({
      required_error: 'Sets are required',
      invalid_type_error: 'Sets must be a number',
    })
    .positive(),
  reps: z
    .number({
      required_error: 'Reps are required',
      invalid_type_error: 'Reps must be a number',
    })
    .positive(),
  restTime: z
    .number({
      required_error: 'Rest time is required',
      invalid_type_error: 'Rest time must be a number',
    })
    .positive(),
  notes: z.string().optional(),
});

// Define the Zod schema for validation
export const trainingPlanSchema = z.object({
  userId: z.string({
    required_error: 'User ID is required',
    invalid_type_error: 'User ID must be a string',
  }),
  title: z.string({
    required_error: 'Title is required',
    invalid_type_error: 'Title must be a string',
  }),
  description: z.string({
    required_error: 'Description is required',
    invalid_type_error: 'Description must be a string',
  }),
  durationWeeks: z
    .number({
      required_error: 'Duration in weeks is required',
      invalid_type_error: 'Duration must be a number',
    })
    .positive(),
  exercises: z.array(exerciseSchema).default([]),
  difficulty: z
    .enum(['beginner', 'intermediate', 'advanced'])
    .default('beginner'),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create type from Zod schema
export type TrainingPlan = z.infer<typeof trainingPlanSchema>;
export type Exercise = z.infer<typeof exerciseSchema>;

// Define Mongoose schema
export const TrainingPlanSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    durationWeeks: { type: Number, required: true },
    exercises: {
      type: [
        {
          name: { type: String, required: true },
          sets: { type: Number, required: true },
          reps: { type: Number, required: true },
          restTime: { type: Number, required: true },
          notes: { type: String, required: false },
        },
      ],
      default: [],
    },
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'beginner',
    },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

// Add indexes
TrainingPlanSchema.index({ userId: 1 });
TrainingPlanSchema.index({ difficulty: 1 });
TrainingPlanSchema.index({ createdAt: -1 });

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
