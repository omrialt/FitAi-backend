import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { TrainingPlanModule } from './objects/training-plan/training-plan.module';
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
    TrainingPlanModule,
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
