import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiRecommendationSchema } from './ai-recommendation.schema';
import { AiRecommendationService } from './ai-recommendation.service';
import { AiRecommendationController } from './ai-recommendation.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'AiRecommendation', schema: AiRecommendationSchema },
    ]),
  ],
  controllers: [AiRecommendationController],
  providers: [AiRecommendationService],
  exports: [AiRecommendationService],
})
export class AiRecommendationModule {}
