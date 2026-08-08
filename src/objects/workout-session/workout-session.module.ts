import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkoutSessionSchema } from './workout-session.schema';
import { WorkoutSessionService } from './workout-session.service';
import { WorkoutStatsService } from './workout-stats.service';
import { WorkoutSessionController } from './workout-session.controller';
import { TrainingPlanSchema } from '../training-plan/training-plan.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'WorkoutSession', schema: WorkoutSessionSchema },
      // Read-only: adherence needs to know which weekdays the active plans
      // schedule. Nothing here writes to training plans.
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
    ]),
  ],
  controllers: [WorkoutSessionController],
  providers: [WorkoutSessionService, WorkoutStatsService],
  exports: [WorkoutSessionService, WorkoutStatsService],
})
export class WorkoutSessionModule {}
