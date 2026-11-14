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

describe('AiRecommendationSchema pre-save hook', () => {
  // Same call as AiReviewService.generateFor(); only the driver write is
  // stubbed, so the real pre-save validation runs.
  const Model = model('AiRecommendationSaveSpec', AiRecommendationSchema);

  let insertOne: jest.SpyInstance;

  beforeEach(() => {
    insertOne = jest
      .spyOn(Model.collection, 'insertOne')
      .mockResolvedValue({ acknowledged: true } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('saves a weekly review for an ObjectId user', async () => {
    const userId = new Types.ObjectId();
    const doc = await Model.create({
      ...base,
      userId,
      metadata: {
        tokensUsed: 10,
        version: 'weekly-review-1',
        tags: ['weekly'],
      },
    });
    expect(doc.userId).toEqual(userId);
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it('still rejects an invalid document', async () => {
    await expect(
      Model.create({ ...base, userId: new Types.ObjectId(), category: 'x' }),
    ).rejects.toThrow();
    expect(insertOne).not.toHaveBeenCalled();
  });
});
