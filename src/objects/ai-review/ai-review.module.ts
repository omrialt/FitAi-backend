import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AiReviewService } from './ai-review.service';
import { AiReviewScheduler } from './ai-review.scheduler';
import { AiReviewController } from './ai-review.controller';
import { AiRecommendationSchema } from '../ai-recommendation/ai-recommendation.schema';
import { WorkoutSessionSchema } from '../workout-session/workout-session.schema';
import { UserSchema } from '../user/user.schema';
import { WorkoutSessionModule } from '../workout-session/workout-session.module';
import { NodemailerModule } from '../../common/nodemailer/nodemailer.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'AiRecommendation', schema: AiRecommendationSchema },
      { name: 'WorkoutSession', schema: WorkoutSessionSchema },
      { name: 'User', schema: UserSchema },
    ]),
    // Reuses the derived statistics rather than recomputing them here: the
    // review must describe the same numbers the user sees on the dashboard.
    WorkoutSessionModule,
    NodemailerModule,
  ],
  controllers: [AiReviewController],
  providers: [AiReviewService, AiReviewScheduler],
  exports: [AiReviewService],
})
export class AiReviewModule {}
