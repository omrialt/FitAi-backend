import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserSchema } from './user.schema';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TrainingPlanSchema } from '../training-plan/training-plan.schema';
import { NutritionPlanSchema } from '../nutrition-plan/nutrition-plan.schema';
import { TokenBlacklistSchema } from '../auth/token-blacklist.schema';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { RefreshTokenFamilySchema } from '../auth/refresh-token-family.schema';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
      { name: 'NutritionPlan', schema: NutritionPlanSchema },
      { name: 'TokenBlacklist', schema: TokenBlacklistSchema },
      // Provided here rather than imported from AuthModule (which already
      // imports this module) so an admin role change can end the user's
      // sessions without a circular import.
      { name: 'RefreshTokenFamily', schema: RefreshTokenFamilySchema },
    ]),
    // Admin deletion delegates to the same cascade as self-service deletion,
    // so there is one definition of what deleting an account means.
    AccountModule,
  ],
  controllers: [UserController, AdminController],
  providers: [
    UserService,
    AdminService,
    RefreshTokenService,
    {
      provide: 'TokenBlacklistService',
      useClass: TokenBlacklistService,
    },
  ],
  exports: [UserService],
})
export class UserModule {}
