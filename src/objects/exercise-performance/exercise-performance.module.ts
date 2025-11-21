import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExercisePerformanceSchema } from './exercise-performance.schema';
import { ExercisePerformanceService } from './exercise-performance.service';
import { ExercisePerformanceController } from './exercise-performance.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'ExercisePerformance', schema: ExercisePerformanceSchema },
    ]),
  ],
  controllers: [ExercisePerformanceController],
  providers: [ExercisePerformanceService],
  exports: [ExercisePerformanceService],
})
export class ExercisePerformanceModule {}