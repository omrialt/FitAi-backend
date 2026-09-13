import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Same numeric metrics physical-data tracks, minus heightCm (not a fitness
// goal - it doesn't change). One target document can bundle several of them
// under a single deadline, e.g. weight + waist together for "summer goal".
export const targetValuesSchema = z
  .object({
    weightKg: z.number().positive().optional(),
    bodyFatPercent: z.number().min(0).max(100).optional(),
    chest: z.number().positive().optional(),
    waist: z.number().positive().optional(),
    hips: z.number().positive().optional(),
    arms: z.number().positive().optional(),
    legs: z.number().positive().optional(),
  })
  .refine((values) => Object.values(values).some((v) => v !== undefined), {
    message: 'At least one target metric must be provided',
  });

export const physicalTargetStatusValues = [
  'active',
  'achieved',
  'abandoned',
] as const;

export const physicalTargetSchema = z.object({
  userId: z.union([
    z.string({
      required_error: 'User ID is required for shared access',
      invalid_type_error: 'User ID must be a string',
    }),
    z.object({}).passthrough(), // Accepts ObjectId or any object
  ]),
  name: z.string().trim().min(1).max(100).optional(),
  targetDate: z.date(),
  targetValues: targetValuesSchema,
  startValues: targetValuesSchema.optional(),
  startDate: z.date().default(() => new Date()),
  status: z.enum(physicalTargetStatusValues).default('active'),
  notes: z.string().trim().max(500).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type PhysicalTarget = z.infer<typeof physicalTargetSchema>;
export type PhysicalTargetValues = z.infer<typeof targetValuesSchema>;
export type PhysicalTargetStatus = (typeof physicalTargetStatusValues)[number];

const targetValuesDefinition = {
  weightKg: { type: Number },
  bodyFatPercent: { type: Number, min: 0, max: 100 },
  chest: { type: Number },
  waist: { type: Number },
  hips: { type: Number },
  arms: { type: Number },
  legs: { type: Number },
};

export const PhysicalTargetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, trim: true, maxlength: 100 },
    targetDate: { type: Date, required: true },
    targetValues: { type: targetValuesDefinition, required: true },
    startValues: { type: targetValuesDefinition, required: false },
    startDate: { type: Date, required: true, default: Date.now },
    status: {
      type: String,
      enum: physicalTargetStatusValues,
      default: 'active',
    },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

PhysicalTargetSchema.index({ userId: 1 });
PhysicalTargetSchema.index({ userId: 1, status: 1 });
PhysicalTargetSchema.index({ userId: 1, targetDate: 1 });

PhysicalTargetSchema.pre('save', function (next) {
  const result = physicalTargetSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

export type PhysicalTargetDocument = HydratedDocument<PhysicalTarget>;
export type PhysicalTargetModel = Model<PhysicalTargetDocument>;
