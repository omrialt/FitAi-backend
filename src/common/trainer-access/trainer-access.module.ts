import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrainerConnectionSchema } from '../../objects/trainer-connection/trainer-connection.schema';
import { TrainerAccessService } from './trainer-access.service';

/**
 * @Global() on purpose: `UserOwnershipGuard` depends on TrainerAccessService
 * and is mounted by training-plan, physical-data, progress-stats,
 * ai-recommendation and current-status alike. Without a global module every
 * one of those would need to import this just to satisfy the guard's
 * constructor — five identical imports that say nothing about the feature.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'TrainerConnection', schema: TrainerConnectionSchema },
    ]),
  ],
  providers: [TrainerAccessService],
  exports: [TrainerAccessService],
})
export class TrainerAccessModule {}
