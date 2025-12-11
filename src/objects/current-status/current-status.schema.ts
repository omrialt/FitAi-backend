import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define Zod enums
export const phaseSchema = z.enum(['cut', 'bulk', 'maintain']);

// Define the Zod schema for validation
export const currentStatusSchema = z.object({
  userId: z.union([
    z.string({
      required_error: 'User ID is required for shared access',
      invalid_type_error: 'User ID must be a string',
    }),
    z.object({}).passthrough(), // Accepts ObjectId or any object
  ]),
  activeTrainingPlanId: z.string().optional().nullable(),
  activeMenuId: z.string().optional().nullable(),
  lastWorkoutDate: z.date().optional(),
  nextWorkoutDate: z.date().optional(),
  phase: phaseSchema.default('maintain'),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create types from Zod schema
export type CurrentStatus = z.infer<typeof currentStatusSchema>;
export type Phase = z.infer<typeof phaseSchema>;

// Define Mongoose schema
export const CurrentStatusSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    activeTrainingPlanId: {
      type: Schema.Types.ObjectId,
      ref: 'TrainingPlan',
      default: null,
    },
    activeMenuId: {
      type: Schema.Types.ObjectId,
      ref: 'NutritionPlan',
      default: null,
    },
    lastWorkoutDate: { type: Date },
    nextWorkoutDate: { type: Date },
    phase: {
      type: String,
      enum: ['cut', 'bulk', 'maintain'],
      default: 'maintain',
    },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

// Add indexes
CurrentStatusSchema.index({ userId: 1 });
CurrentStatusSchema.index({ activeTrainingPlanId: 1 });
CurrentStatusSchema.index({ activeMenuId: 1 });
CurrentStatusSchema.index({ phase: 1 });
CurrentStatusSchema.index({ lastWorkoutDate: -1 });
CurrentStatusSchema.index({ nextWorkoutDate: 1 });

// Add validation middleware
CurrentStatusSchema.pre('save', function (next) {
  const result = currentStatusSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

// Type for a hydrated document
export type CurrentStatusDocument = HydratedDocument<CurrentStatus>;

// Type for the model
export type CurrentStatusModel = Model<CurrentStatusDocument>;