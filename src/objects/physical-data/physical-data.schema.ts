import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define the Measurements schema
export const measurementsSchema = z.object({
  chest: z.number().positive().optional(),
  waist: z.number().positive().optional(),
  hips: z.number().positive().optional(),
  arms: z.number().positive().optional(),
  legs: z.number().positive().optional(),
});

// Define the Zod schema for validation
export const physicalDataSchema = z.object({
  userId: z.string({
    required_error: 'User ID is required',
    invalid_type_error: 'User ID must be a string',
  }),
  heightCm: z
    .number({
      required_error: 'Height in cm is required',
      invalid_type_error: 'Height must be a number',
    })
    .positive(),
  weightKg: z
    .number({
      required_error: 'Weight in kg is required',
      invalid_type_error: 'Weight must be a number',
    })
    .positive(),
  bodyFatPercent: z.number().min(0).max(100).optional(),
  measurements: measurementsSchema.optional(),
  dateRecorded: z.date().default(() => new Date()),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create types from Zod schema
export type PhysicalData = z.infer<typeof physicalDataSchema>;
export type Measurements = z.infer<typeof measurementsSchema>;

// Define Mongoose schema
export const PhysicalDataSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    heightCm: { type: Number, required: true },
    weightKg: { type: Number, required: true },
    bodyFatPercent: { type: Number, min: 0, max: 100 },
    measurements: {
      type: {
        chest: { type: Number },
        waist: { type: Number },
        hips: { type: Number },
        arms: { type: Number },
        legs: { type: Number },
      },
      required: false,
    },
    dateRecorded: { type: Date, required: true, default: Date.now },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

// Add indexes
PhysicalDataSchema.index({ userId: 1 });
PhysicalDataSchema.index({ dateRecorded: -1 });
PhysicalDataSchema.index({ userId: 1, dateRecorded: -1 });
PhysicalDataSchema.index({ createdAt: -1 });

// Add validation middleware
PhysicalDataSchema.pre('save', function (next) {
  const result = physicalDataSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

// Type for a hydrated document
export type PhysicalDataDocument = HydratedDocument<PhysicalData>;

// Type for the model
export type PhysicalDataModel = Model<PhysicalDataDocument>;
