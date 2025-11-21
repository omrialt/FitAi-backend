import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProgressStatsSchema } from './progress-stats.schema';
import { ProgressStatsService } from './progress-stats.service';
import { ProgressStatsController } from './progress-stats.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'ProgressStats', schema: ProgressStatsSchema },
    ]),
  ],
  controllers: [ProgressStatsController],
  providers: [ProgressStatsService],
  exports: [ProgressStatsService],
})
export class ProgressStatsModule {}