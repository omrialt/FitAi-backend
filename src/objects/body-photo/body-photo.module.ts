import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BodyPhotoSchema } from './body-photo.schema';
import { BodyPhotoService } from './body-photo.service';
import { BodyPhotoController } from './body-photo.controller';
import { CloudinaryModule } from '../../common/cloudinary/cloudinary.module';

/**
 * `TrainerAccessService` is resolved from the global module, the same way
 * `UserOwnershipGuard` resolves it — this module checks the coaching
 * relationship itself rather than delegating to that guard, because the guard
 * can only answer half of the question these photos ask.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'BodyPhoto', schema: BodyPhotoSchema }]),
    CloudinaryModule,
  ],
  controllers: [BodyPhotoController],
  providers: [BodyPhotoService],
  exports: [BodyPhotoService],
})
export class BodyPhotoModule {}
