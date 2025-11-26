import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { getDatabaseConfig } from './config/database.config';
import { UserModule } from './objects/user/user.module';
import { AuthModule } from './objects/auth/auth.module';
import { TrainingPlanModule } from './objects/training-plan/training-plan.module';
import { NutritionPlanModule } from './objects/nutrition-plan/nutrition-plan.module';
import { AiRecommendationModule } from './objects/ai-recommendation/ai-recommendation.module';
import { PhysicalDataModule } from './objects/physical-data/physical-data.module';
import { CloudinaryModule } from './common/cloudinary/cloudinary.module';
import { NodemailerModule } from './common/nodemailer/nodemailer.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
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
  ],
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
