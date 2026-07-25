import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrainerConnectionSchema } from './trainer-connection.schema';
import { UserSchema } from '../user/user.schema';
import { TrainerConnectionService } from './trainer-connection.service';
import { TrainerConnectionController } from './trainer-connection.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'TrainerConnection', schema: TrainerConnectionSchema },
      { name: 'User', schema: UserSchema }, // service writes User.trainerId
    ]),
    AuthModule, // provides JwtStrategy + PassportModule for the JWT guard
  ],
  controllers: [TrainerConnectionController],
  providers: [TrainerConnectionService],
  exports: [TrainerConnectionService],
})
export class TrainerConnectionModule {}
