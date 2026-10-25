import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeviceTokenSchema } from './device-token.schema';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { UserSchema } from '../user/user.schema';

/**
 * Global so messages, plan assignment and trainer connections can each send a
 * push without importing one another's modules.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'DeviceToken', schema: DeviceTokenSchema },
      { name: 'User', schema: UserSchema },
    ]),
  ],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
