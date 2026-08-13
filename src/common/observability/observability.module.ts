import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { UserSchema } from '../../objects/user/user.schema';
import { TrainingPlanSchema } from '../../objects/training-plan/training-plan.schema';
import { NodemailerModule } from '../nodemailer/nodemailer.module';
import { AlertService } from './alert.service';
import { HealthProbeService } from './health-probe.service';
import { MonitorCronController } from './monitor-cron.controller';

/**
 * @Global() because GlobalExceptionFilter resolves AlertService, and a filter
 * registered through APP_FILTER is constructed by the root injector — it has
 * no module of its own to import this from.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
    ]),
    NodemailerModule,
  ],
  controllers: [MonitorCronController],
  providers: [AlertService, HealthProbeService],
  exports: [AlertService, HealthProbeService],
})
export class ObservabilityModule {}
