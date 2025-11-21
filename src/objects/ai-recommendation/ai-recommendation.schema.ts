import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define Zod enums
export const recommendationCategorySchema = z.enum([
  'training',
  'nutrition',
  'general',
]);

export const generatedBySchema = z.enum(['ai', 'trainer']);

// Define metadata schema
export const metadataSchema = z
  .object({
    prompt: z.string().optional(),
    temperature: z.number().optional(),
    tokensUsed: z.number().optional(),
    version: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .optional();

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
  generatedBy: generatedBySchema,
  aiModelUsed: z.string().nullable(),
  metadata: metadataSchema.default({}),
  createdAt: z.date().optional(),
});

// Create types from Zod schema
export type AiRecommendation = z.infer<typeof aiRecommendationSchema>;
export type RecommendationCategory = z.infer<
  typeof recommendationCategorySchema
>;
export type GeneratedBy = z.infer<typeof generatedBySchema>;
export type RecommendationMetadata = z.infer<typeof metadataSchema>;

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
    generatedBy: {
      type: String,
      enum: ['ai', 'trainer'],
      required: true,
    },
    aiModelUsed: { type: String, default: null },
    metadata: {
      type: {
        prompt: { type: String },
        temperature: { type: Number },
        tokensUsed: { type: Number },
        version: { type: String },
        tags: [{ type: String }],
      },
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    validateBeforeSave: true,
  },
);

// Add indexes
AiRecommendationSchema.index({ userId: 1 });
AiRecommendationSchema.index({ category: 1 });
AiRecommendationSchema.index({ generatedBy: 1 });
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
