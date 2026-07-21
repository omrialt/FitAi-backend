import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProgressStatsSchema } from './progress-stats.schema';
import { ProgressStatsService } from './progress-stats.service';
import { ProgressStatsController } from './progress-stats.controller';
import { PhysicalDataSchema } from '../physical-data/physical-data.schema';
import { TrainingPlanSchema } from '../training-plan/training-plan.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'ProgressStats', schema: ProgressStatsSchema },
      // Read-only sources for regenerating stats
      { name: 'PhysicalData', schema: PhysicalDataSchema },
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
    ]),
  ],
  controllers: [ProgressStatsController],
  providers: [ProgressStatsService],
  exports: [ProgressStatsService],
})
export class ProgressStatsModule {}