import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { MealLogSchema } from './meal-log.schema';
import { MealLogService } from './meal-log.service';
import { MealLogController } from './meal-log.controller';
import { NutritionPlanSchema } from '../nutrition-plan/nutrition-plan.schema';
import { CurrentStatusSchema } from '../current-status/current-status.schema';

/**
 * The two extra models are read-only from here: the target comes from whichever
 * nutrition plan `CurrentStatus.activeMenuId` points at, and nothing in this
 * module writes to either. Registering the schemas directly rather than
 * importing the feature modules keeps that one-way relationship obvious and
 * avoids a circular import back through the nutrition module.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'MealLog', schema: MealLogSchema },
      { name: 'NutritionPlan', schema: NutritionPlanSchema },
      { name: 'CurrentStatus', schema: CurrentStatusSchema },
    ]),
  ],
  controllers: [MealLogController],
  providers: [MealLogService],
  exports: [MealLogService],
})
export class MealLogModule {}
