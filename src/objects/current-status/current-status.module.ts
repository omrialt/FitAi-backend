import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CurrentStatusSchema } from './current-status.schema';
import { CurrentStatusService } from './current-status.service';
import { CurrentStatusController } from './current-status.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'CurrentStatus', schema: CurrentStatusSchema },
    ]),
  ],
  controllers: [CurrentStatusController],
  providers: [CurrentStatusService],
  exports: [CurrentStatusService],
})
export class CurrentStatusModule {}