import { Types, model } from 'mongoose';
import {
  aiRecommendationSchema,
  AiRecommendationSchema,
} from './ai-recommendation.schema';

const base = {
  category: 'training' as const,
  content: 'Weekly review',
  generatedBy: 'ai' as const,
  aiModelUsed: 'model',
};

describe('aiRecommendationSchema', () => {
  it('accepts a string userId', () => {
    const result = aiRecommendationSchema.safeParse({
      ...base,
      userId: new Types.ObjectId().toHexString(),
    });
    expect(result.success).toBe(true);
  });

  // A hydrated document's toObject() yields an ObjectId, which the pre-save
  // hook validates. Rejecting it made every POST /ai-review/me fail with 500.
  it('accepts an ObjectId userId as produced by toObject()', () => {
    const Model = model('AiRecommendationSpec', AiRecommendationSchema);
    const doc = new Model({ ...base, userId: new Types.ObjectId() });
    const result = aiRecommendationSchema.safeParse(doc.toObject());
    expect(result.success).toBe(true);
  });
});
