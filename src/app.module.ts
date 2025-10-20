import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { UserModule } from './objects/user/user.module';
import { TrainingPlanModule } from './objects/training-plan/training-plan.module';
import { NutritionPlanModule } from './objects/nutrition-plan/nutrition-plan.module';
import { AiRecommendationModule } from './objects/ai-recommendation/ai-recommendation.module';
import { PhysicalDataModule } from './objects/physical-data/physical-data.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RolesGuard } from './common/guards/roles.guard';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    MongooseModule.forRoot(
      process.env.MONGO_URI || 'mongodb://localhost:27017/fitai',
    ),
    UserModule,
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
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}
