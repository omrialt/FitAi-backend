import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NutritionPlanSchema } from './nutrition-plan.schema';
import { NutritionPlanService } from './nutrition-plan.service';
import { NutritionPlanController } from './nutrition-plan.controller';
import { CurrentStatusModule } from '../current-status/current-status.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'NutritionPlan', schema: NutritionPlanSchema },
    ]),
    CurrentStatusModule,
  ],
  controllers: [NutritionPlanController],
  providers: [NutritionPlanService],
  exports: [NutritionPlanService],
})
export class NutritionPlanModule {}
