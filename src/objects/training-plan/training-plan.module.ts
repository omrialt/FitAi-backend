import { Module, NestModule, MiddlewareConsumer, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrainingPlanSchema } from './training-plan.schema';
import { UserSchema } from '../user/user.schema';
import { TrainingPlanService } from './training-plan.service';
import { TemplateService } from './template.service';
import { TrainingPlanController } from './training-plan.controller';
import { LoggerMiddleware } from '../../common/middleware/logger.middleware';
import { AuthModule } from '../auth/auth.module';
import { CurrentStatusModule } from '../current-status/current-status.module';
import { CalendarSyncModule } from '../calendar-sync/calendar-sync.module';
import { ExerciseModule } from '../exercise/exercise.module';
import { WorkoutSessionModule } from '../workout-session/workout-session.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
      { name: 'User', schema: UserSchema }, // Add User model for JwtStrategy
    ]),
    AuthModule, // Import AuthModule to get JwtStrategy and PassportModule
    CurrentStatusModule,
    forwardRef(() => CalendarSyncModule),
    // A template stores catalogue slugs and percentages; turning either into
    // something a user can train needs the catalogue's names and the log's
    // estimated maxes. Both are read-only from here.
    ExerciseModule,
    WorkoutSessionModule,
  ],
  controllers: [TrainingPlanController],
  providers: [TrainingPlanService, TemplateService],
  exports: [TrainingPlanService, TemplateService],
})
export class TrainingPlanModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('training-plans');
  }
}
