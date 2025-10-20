import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define Zod enums
export const recommendationCategorySchema = z.enum([
  'training',
  'nutrition',
  'general',
]);

// Define the Zod schema for validation
export const aiRecommendationSchema = z.object({
  userId: z.string({
    required_error: 'User ID is required',
    invalid_type_error: 'User ID must be a string',
  }),
  category: recommendationCategorySchema,
  content: z.string({
    required_error: 'Content is required',
    invalid_type_error: 'Content must be a string',
  }),
  aiModelUsed: z.string({
    required_error: 'AI model used is required',
    invalid_type_error: 'AI model must be a string',
  }),
  metadata: z.record(z.any()).default({}),
  createdAt: z.date().optional(),
});

// Create types from Zod schema
export type AiRecommendation = z.infer<typeof aiRecommendationSchema>;
export type RecommendationCategory = z.infer<
  typeof recommendationCategorySchema
>;

// Define Mongoose schema
export const AiRecommendationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    category: {
      type: String,
      enum: ['training', 'nutrition', 'general'],
      required: true,
    },
    content: { type: String, required: true },
    aiModelUsed: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    validateBeforeSave: true,
  },
);

// Add indexes
AiRecommendationSchema.index({ userId: 1 });
AiRecommendationSchema.index({ category: 1 });
AiRecommendationSchema.index({ createdAt: -1 });
AiRecommendationSchema.index({ userId: 1, createdAt: -1 });

// Add validation middleware
AiRecommendationSchema.pre('save', function (next) {
  const result = aiRecommendationSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

// Type for a hydrated document
export type AiRecommendationDocument = HydratedDocument<AiRecommendation>;

// Type for the model
export type AiRecommendationModel = Model<AiRecommendationDocument>;
