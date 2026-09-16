import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { getDatabaseConfig } from './config/database.config';
import { UserModule } from './objects/user/user.module';
import { AccountModule } from './objects/account/account.module';
import { AuthModule } from './objects/auth/auth.module';
import { TrainingPlanModule } from './objects/training-plan/training-plan.module';
import { NutritionPlanModule } from './objects/nutrition-plan/nutrition-plan.module';
import { AiRecommendationModule } from './objects/ai-recommendation/ai-recommendation.module';
import { PhysicalDataModule } from './objects/physical-data/physical-data.module';
import { PhysicalTargetModule } from './objects/physical-target/physical-target.module';
import { ProgressStatsModule } from './objects/progress-stats/progress-stats.module';
import { WorkoutSessionModule } from './objects/workout-session/workout-session.module';
import { ExerciseModule } from './objects/exercise/exercise.module';
import { AiReviewModule } from './objects/ai-review/ai-review.module';
import { AnthropicModule } from './common/anthropic/anthropic.module';
import { FoodModule } from './objects/food/food.module';
import { AiCoachModule } from './objects/ai-coach/ai-coach.module';
import { BodyPhotoModule } from './objects/body-photo/body-photo.module';
import { MealLogModule } from './objects/meal-log/meal-log.module';
import { CalendarSyncModule } from './objects/calendar-sync/calendar-sync.module';
import { TrainerConnectionModule } from './objects/trainer-connection/trainer-connection.module';
import { CloudinaryModule } from './common/cloudinary/cloudinary.module';
import { TrainerAccessModule } from './common/trainer-access/trainer-access.module';
import { NodemailerModule } from './common/nodemailer/nodemailer.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { RequestIdMiddleware } from './common/observability/request-id.middleware';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HealthController } from './common/health/health.controller';
import { forgotPasswordLimiter } from './common/middleware/rate-limit';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      useFactory: () => getDatabaseConfig(),
    }),
    CloudinaryModule,
    NodemailerModule,
    // Global — one client, so the four AI features share one set of
    // `lastCallAt` / `lastError` counters and the status route can answer
    // "has this ever worked" rather than only "is a key present".
    AnthropicModule,
    // Global — the exception filter is built by the root injector and resolves
    // AlertService from here.
    ObservabilityModule,
    // Global — UserOwnershipGuard resolves TrainerAccessService from here no
    // matter which feature module mounted the guard.
    TrainerAccessModule,
    UserModule,
    AccountModule,
    AuthModule,
    TrainingPlanModule,
    NutritionPlanModule,
    // The other half of the nutrition story: plans say what to eat, this
    // records what was eaten, and only both together make "remaining today"
    // a number rather than a guess.
    MealLogModule,
    AiRecommendationModule,
    PhysicalDataModule,
    PhysicalTargetModule,
    // Photos are private on upload and shared one at a time. Deliberately not
    // covered by UserOwnershipGuard: a trainer's access to the measurements
    // grants nothing here.
    BodyPhotoModule,
    ProgressStatsModule,
    WorkoutSessionModule,
    // Shared reference content: read-only for every signed-in user, seeded by
    // `npm run seed:exercises` rather than written through the API.
    ExerciseModule,
    // Same idea one collection over: a local cache of USDA's public nutrition
    // rows, so an hourly quota shared by every user is not spent re-asking for
    // "chicken breast". Inert without FDC_API_KEY.
    FoodModule,
    // Inert unless ANTHROPIC_API_KEY is set: the first thing here that costs
    // money per use does not switch itself on merely by being deployed.
    AiReviewModule,
    // The two features whose answers are genuinely not computable: a plan for
    // one person's constraints, and a question asked in their own words. Both
    // are grounded in the catalogue and the log, and both are inert without
    // the same key.
    AiCoachModule,
    CalendarSyncModule,
    TrainerConnectionModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // First, and on everything: the id has to exist before anything that might
    // log or fail can reference it.
    consumer.apply(RequestIdMiddleware).forRoutes('*');

    // Applied here rather than on the raw Express instance because this
    // limiter keys off `req.body.email`, and Nest's body parser only runs
    // once the request reaches the Nest pipeline.
    consumer
      .apply(forgotPasswordLimiter)
      .forRoutes({ path: 'auth/forgot-password', method: RequestMethod.POST });
  }
}
