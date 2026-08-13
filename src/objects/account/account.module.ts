import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UserSchema } from '../user/user.schema';
import { TrainingPlanSchema } from '../training-plan/training-plan.schema';
import { NutritionPlanSchema } from '../nutrition-plan/nutrition-plan.schema';
import { PhysicalDataSchema } from '../physical-data/physical-data.schema';
import { ProgressStatsSchema } from '../progress-stats/progress-stats.schema';
import { CurrentStatusSchema } from '../current-status/current-status.schema';
import { WorkoutSessionSchema } from '../workout-session/workout-session.schema';
import { AiRecommendationSchema } from '../ai-recommendation/ai-recommendation.schema';
import { TrainerConnectionSchema } from '../trainer-connection/trainer-connection.schema';
import { TokenBlacklistSchema } from '../auth/token-blacklist.schema';
import { RefreshTokenFamilySchema } from '../auth/refresh-token-family.schema';
import { AuthCodeSchema } from '../auth/auth-code.schema';
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';

/**
 * Registers every collection that stores something about a user.
 *
 * The long import list is the point rather than a smell: it is the explicit,
 * checkable answer to "where does this person's data live?", and export and
 * erasure both depend on that answer being complete. A collection added later
 * and not added here is a collection that survives a deletion request.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
      { name: 'NutritionPlan', schema: NutritionPlanSchema },
      { name: 'PhysicalData', schema: PhysicalDataSchema },
      { name: 'ProgressStats', schema: ProgressStatsSchema },
      { name: 'CurrentStatus', schema: CurrentStatusSchema },
      { name: 'WorkoutSession', schema: WorkoutSessionSchema },
      { name: 'AiRecommendation', schema: AiRecommendationSchema },
      { name: 'TrainerConnection', schema: TrainerConnectionSchema },
      { name: 'TokenBlacklist', schema: TokenBlacklistSchema },
      { name: 'RefreshTokenFamily', schema: RefreshTokenFamilySchema },
      { name: 'AuthCode', schema: AuthCodeSchema },
    ]),
    CloudinaryModule,
  ],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}
