import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkoutSessionSchema } from './workout-session.schema';
import { WorkoutSessionService } from './workout-session.service';
import { WorkoutStatsService } from './workout-stats.service';
import { ProgressionService } from './progression.service';
import { WorkoutSessionController } from './workout-session.controller';
import { TrainingPlanSchema } from '../training-plan/training-plan.schema';
import { ExerciseModule } from '../exercise/exercise.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'WorkoutSession', schema: WorkoutSessionSchema },
      // Read-only: adherence needs to know which weekdays the active plans
      // schedule. Nothing here writes to training plans.
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
    ]),
    // The overload coach asks the catalogue what a lift is loaded with, so the
    // increment it suggests is one the equipment can actually be set to: 2.5kg
    // on a barbell, 5kg on a machine stack, and nothing at all on a pull-up.
    ExerciseModule,
  ],
  controllers: [WorkoutSessionController],
  providers: [WorkoutSessionService, WorkoutStatsService, ProgressionService],
  exports: [WorkoutSessionService, WorkoutStatsService, ProgressionService],
})
export class WorkoutSessionModule {}
