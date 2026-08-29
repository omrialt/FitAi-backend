import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ExerciseSchema } from './exercise.schema';
import { ExerciseService } from './exercise.service';
import { ExerciseController } from './exercise.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'Exercise', schema: ExerciseSchema }]),
  ],
  controllers: [ExerciseController],
  providers: [ExerciseService],
  // Exported for whatever reads the catalogue next — exercise substitution is
  // the first candidate, and it belongs in its own module rather than here.
  exports: [ExerciseService],
})
export class ExerciseModule {}
