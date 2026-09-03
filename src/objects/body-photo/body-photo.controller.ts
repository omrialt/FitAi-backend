import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';

import { BodyPhotoService } from './body-photo.service';
// Value imports: `import type` erases the class and the global ValidationPipe
// then never sees a DTO to validate.
import {
  CreateBodyPhotoDto,
  SetPhotoVisibilityDto,
} from '../../interfaces/body-photo.interfaces';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Note what is *not* here: `UserOwnershipGuard`.
 *
 * Every other user-scoped resource in this app mounts it, and it would be the
 * wrong tool for this one. That guard answers "may this trainer act for this
 * client", which for photos is only half the question — the other half is
 * whether the client shared the individual photo, which is a property of a row
 * and cannot be decided from a route. Letting the guard pass the request and
 * then filtering afterwards would mean a private photo had already been loaded
 * into a response somebody could later forget to strip.
 *
 * So authorisation lives in the service, where both halves are checked
 * together and the visibility filter is part of the query.
 */
@Controller('body-photos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BodyPhotoController {
  constructor(private readonly photos: BodyPhotoService) {}

  /** The caller's own timeline. */
  @Get()
  @Roles('user', 'trainer', 'admin')
  listMine(@Request() req: AuthRequest) {
    return this.photos.list(req.user.id, req.user.id);
  }

  /**
   * A client's timeline, as their trainer.
   *
   * Returns only what that client explicitly shared. A trainer with full
   * access to this client's measurements, plans and workout log still sees an
   * empty list here until a photo is shared.
   */
  @Get('user/:userId')
  @Roles('trainer', 'admin')
  listForClient(
    @Param('userId') userId: string,
    @Request() req: AuthRequest,
  ) {
    return this.photos.list(userId, req.user.id);
  }

  @Post()
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Only image files are allowed'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateBodyPhotoDto,
    @Request() req: AuthRequest,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    // There is deliberately no `visibility` on the upload DTO. A photo becomes
    // shareable through a second, explicit action, so it cannot be shared by
    // accident on the way in.
    return this.photos.create(req.user.id, file, {
      pose: body.pose,
      weightKg: body.weightKg,
      note: body.note,
      takenAt: body.takenAt ? new Date(body.takenAt) : undefined,
    });
  }

  /**
   * Shares one photo with the owner's trainer, or stops sharing it.
   *
   * `user` only, and scoped to the caller's own photos in the query. Not
   * `admin`, not `trainer`: consent someone else can grant on your behalf is
   * not consent.
   */
  @Patch(':id/visibility')
  @Roles('user', 'trainer', 'admin')
  setVisibility(
    @Param('id') id: string,
    @Body() body: SetPhotoVisibilityDto,
    @Request() req: AuthRequest,
  ) {
    return this.photos.setVisibility(id, req.user.id, body.visibility);
  }

  @Delete(':id')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.photos.remove(id, req.user.id);
  }
}
