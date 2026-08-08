import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProgressStatsSchema } from './progress-stats.schema';
import { ProgressStatsService } from './progress-stats.service';
import { ProgressStatsController } from './progress-stats.controller';
import { PhysicalDataSchema } from '../physical-data/physical-data.schema';
import { TrainingPlanSchema } from '../training-plan/training-plan.schema';
import { WorkoutSessionSchema } from '../workout-session/workout-session.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'ProgressStats', schema: ProgressStatsSchema },
      // Read-only sources for regenerating stats
      { name: 'PhysicalData', schema: PhysicalDataSchema },
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
      // Workouts are counted from sessions now; the plan documents above stay
      // as the fallback source until the backfill has run everywhere.
      { name: 'WorkoutSession', schema: WorkoutSessionSchema },
    ]),
  ],
  controllers: [ProgressStatsController],
  providers: [ProgressStatsService],
  exports: [ProgressStatsService],
})
export class ProgressStatsModule {}
