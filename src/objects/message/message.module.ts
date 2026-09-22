import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MessageSchema } from './message.schema';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { UserSchema } from '../user/user.schema';

/**
 * `TrainerAccessService` is not imported here — it is provided by a @Global()
 * module, the same one the ownership guard resolves it from, so the
 * authorization question and the thread lookup are answered by one instance
 * reading one collection.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Message', schema: MessageSchema },
      // Read-only: thread lists show who the other party is.
      { name: 'User', schema: UserSchema },
    ]),
  ],
  controllers: [MessageController],
  providers: [MessageService],
  exports: [MessageService],
})
export class MessageModule {}
