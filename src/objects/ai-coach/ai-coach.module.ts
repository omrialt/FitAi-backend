import { Module } from '@nestjs/common';

import { AiCoachController } from './ai-coach.controller';
import { CoachChatService } from './coach-chat.service';
import { PlanGeneratorService } from './plan-generator.service';
import { ExerciseModule } from '../exercise/exercise.module';
import { WorkoutSessionModule } from '../workout-session/workout-session.module';
import { TrainingPlanModule } from '../training-plan/training-plan.module';

/**
 * The two AI features whose answers are genuinely not computable — a plan for
 * one person's constraints, and a question asked in their own words.
 *
 * Everything they are grounded in comes from modules that already exist and
 * are read-only from here: the catalogue supplies the exercises the model may
 * pick from, and the stats and progression services supply the numbers the
 * chat may cite. `AnthropicService` arrives from the global module, so both
 * features share the same key gate and the same `lastError`.
 */
@Module({
  imports: [ExerciseModule, WorkoutSessionModule, TrainingPlanModule],
  controllers: [AiCoachController],
  providers: [CoachChatService, PlanGeneratorService],
  exports: [CoachChatService, PlanGeneratorService],
})
export class AiCoachModule {}
