import { RecommendationCategory } from '../ai-recommendation/ai-recommendation.schema';

export class CreateAiRecommendationDto {
  userId!: string;
  category!: RecommendationCategory;
  content!: string;
  aiModelUsed!: string;
  metadata?: Record<string, any>;
}

export class UpdateAiRecommendationDto {
  content?: string;
  metadata?: Record<string, any>;
}
