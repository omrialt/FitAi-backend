import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrainerDashboardService } from './trainer-dashboard.service';
import { TrainerDashboardController } from './trainer-dashboard.controller';
import { UserSchema } from '../user/user.schema';
import { WorkoutSessionSchema } from '../workout-session/workout-session.schema';
import { PhysicalDataSchema } from '../physical-data/physical-data.schema';
import { TrainingPlanSchema } from '../training-plan/training-plan.schema';
import { WorkoutSessionModule } from '../workout-session/workout-session.module';

/**
 * Read-only across four collections. Nothing here writes, which is why the
 * schemas are registered directly rather than importing each feature module:
 * this screen needs their data, not their behaviour.
 *
 * `WorkoutSessionModule` is the exception — it is imported for the fatigue
 * signal, which is a judgement the stats service owns and should not be
 * reimplemented one floor down.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'WorkoutSession', schema: WorkoutSessionSchema },
      { name: 'PhysicalData', schema: PhysicalDataSchema },
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
    ]),
    WorkoutSessionModule,
  ],
  controllers: [TrainerDashboardController],
  providers: [TrainerDashboardService],
  exports: [TrainerDashboardService],
})
export class TrainerDashboardModule {}
