import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { getDatabaseConfig } from './config/database.config';
import { UserModule } from './objects/user/user.module';
import { AuthModule } from './objects/auth/auth.module';
import { TrainingPlanModule } from './objects/training-plan/training-plan.module';
import { NutritionPlanModule } from './objects/nutrition-plan/nutrition-plan.module';
import { AiRecommendationModule } from './objects/ai-recommendation/ai-recommendation.module';
import { PhysicalDataModule } from './objects/physical-data/physical-data.module';
import { ProgressStatsModule } from './objects/progress-stats/progress-stats.module';
import { CalendarSyncModule } from './objects/calendar-sync/calendar-sync.module';
import { TrainerConnectionModule } from './objects/trainer-connection/trainer-connection.module';
import { CloudinaryModule } from './common/cloudinary/cloudinary.module';
import { NodemailerModule } from './common/nodemailer/nodemailer.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { HealthController } from './common/health/health.controller';

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
    UserModule,
    AuthModule,
    TrainingPlanModule,
    NutritionPlanModule,
    AiRecommendationModule,
    PhysicalDataModule,
    ProgressStatsModule,
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
export class AppModule {}
