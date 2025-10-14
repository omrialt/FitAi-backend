import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define the Zod schema for validation
export const trainingPlanSchema = z.object({
  name: z.string({
    required_error: 'Name is required',
    invalid_type_error: 'Name must be a string',
  }),
  goal: z.string({
    required_error: 'Goal is required',
    invalid_type_error: 'Goal must be a string',
  }),
  exercises: z.array(z.string()).default([]),
  durationWeeks: z.number().optional(),
  isPublic: z.boolean().default(false),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create type from Zod schema
export type TrainingPlan = z.infer<typeof trainingPlanSchema>;

// Define Mongoose schema
export const TrainingPlanSchema = new Schema(
  {
    name: { type: String, required: true },
    goal: { type: String, required: true },
    exercises: { type: [String], default: [] },
    durationWeeks: { type: Number, required: false },
    isPublic: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

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
