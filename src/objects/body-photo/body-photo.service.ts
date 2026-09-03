import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import type {
  BodyPhoto,
  PhotoPose,
  PhotoVisibility,
} from './body-photo.schema';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';

/**
 * The body-photo timeline.
 *
 * Every read in this file goes through `assertCanView`, and the reason it is
 * one method rather than a guard is that the rule is not "does this trainer
 * coach this client" — the ownership guard already answers that for the
 * measurements. It is "does this trainer coach this client **and** did the
 * client share this specific photo", and the second half has no guard because
 * it is a property of a row, not of a route.
 *
 * That asymmetry is the feature. A trainer with full access to a client's
 * measurements, plans, nutrition and workout log still sees nothing here until
 * the client shares a photo, and can lose that access one photo at a time.
 */

/** Kept apart from `fitai/uploads`, which is public-delivery. */
const FOLDER = 'fitai/body-photos';

export interface BodyPhotoView {
  id: string;
  /** Minted per request after the permission check, never stored. */
  url: string;
  pose: PhotoPose;
  visibility: PhotoVisibility;
  weightKg: number | null;
  note: string | null;
  takenAt: Date;
  width: number | null;
  height: number | null;
}

interface PhotoRow extends BodyPhoto {
  _id: Types.ObjectId;
}

@Injectable()
export class BodyPhotoService {
  private readonly logger = new Logger(BodyPhotoService.name);

  constructor(
    @InjectModel('BodyPhoto')
    private readonly photoModel: Model<BodyPhoto>,
    private readonly cloudinary: CloudinaryService,
    private readonly trainerAccess: TrainerAccessService,
  ) {}

  /**
   * One user's timeline, as seen by `viewerId`.
   *
   * A viewer looking at their own photos sees everything. Anyone else sees
   * only what was shared with them, and only if they are an accepted trainer —
   * the visibility filter is applied in the query rather than after it, so a
   * private photo is never loaded into a response object that someone might
   * later forget to strip.
   */
  async list(userId: string, viewerId: string): Promise<BodyPhotoView[]> {
    if (!isValidObjectId(userId)) return [];

    const own = userId === viewerId;

    if (!own && !(await this.trainerAccess.isAcceptedTrainerOf(viewerId, userId))) {
      throw new ForbiddenException('You do not have access to these photos');
    }

    const rows = await this.photoModel
      .find({
        userId: new Types.ObjectId(userId),
        ...(own ? {} : { visibility: 'trainer' }),
      })
      .sort({ takenAt: -1 })
      .lean<PhotoRow[]>()
      .exec();

    return rows.map((row) => this.toView(row));
  }

  async create(
    userId: string,
    file: Express.Multer.File,
    details: {
      pose?: PhotoPose;
      weightKg?: number;
      note?: string;
      takenAt?: Date;
    },
  ): Promise<BodyPhotoView> {
    const uploaded = await this.cloudinary.uploadPrivateImage(file, FOLDER);

    const created = await this.photoModel.create({
      userId: new Types.ObjectId(userId),
      publicId: uploaded.publicId,
      version: uploaded.version,
      width: uploaded.width ?? null,
      height: uploaded.height ?? null,
      pose: details.pose ?? 'front',
      // Never taken from the request. The upload form has no visibility field
      // at all: a photo becomes shareable through a deliberate second action,
      // so there is no way to share one by accident on the way in.
      visibility: 'private',
      weightKg: details.weightKg ?? null,
      note: details.note ?? null,
      takenAt: details.takenAt ?? new Date(),
    });

    return this.toView(created.toObject() as PhotoRow);
  }

  /**
   * Shares one photo with the owner's trainer, or stops sharing it.
   *
   * Only the owner can call this — not an admin, and certainly not the
   * trainer. Consent that someone else can grant on your behalf is not
   * consent, and this is the one place in the app where that distinction is
   * worth an explicit ownership check rather than a role.
   */
  async setVisibility(
    photoId: string,
    userId: string,
    visibility: PhotoVisibility,
  ): Promise<BodyPhotoView> {
    if (!isValidObjectId(photoId)) {
      throw new NotFoundException('Photo not found');
    }

    const updated = await this.photoModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(photoId), userId: new Types.ObjectId(userId) },
        { $set: { visibility } },
        { new: true },
      )
      .lean<PhotoRow>()
      .exec();

    // Filtering on `userId` in the query rather than loading and comparing:
    // someone else's photo is indistinguishable from a missing one in the
    // response, so this does not confirm that a given id exists.
    if (!updated) {
      throw new NotFoundException('Photo not found');
    }

    return this.toView(updated);
  }

  /**
   * Deletes the row and the asset.
   *
   * Cloudinary first, then Mongo — and if Cloudinary fails, nothing is
   * deleted. The other order would leave an orphaned image nobody can find in
   * the app but which is still fetchable by anyone holding a signed URL, and
   * "deleted" would be false in the only sense that matters for this kind of
   * photograph. A row whose asset is already gone still deletes cleanly.
   */
  async remove(photoId: string, userId: string): Promise<void> {
    if (!isValidObjectId(photoId)) {
      throw new NotFoundException('Photo not found');
    }

    const photo = await this.photoModel
      .findOne({
        _id: new Types.ObjectId(photoId),
        userId: new Types.ObjectId(userId),
      })
      .lean<PhotoRow>()
      .exec();

    if (!photo) {
      throw new NotFoundException('Photo not found');
    }

    await this.cloudinary.deleteImage(photo.publicId);
    await this.photoModel.deleteOne({ _id: photo._id }).exec();
  }

  /**
   * Removes every photo a user has, for account deletion.
   *
   * N-12 built export and deletion for the data the app already held. This
   * collection is new data of the most sensitive kind in the product, so it
   * joins that path rather than quietly outliving the account — an image left
   * in Cloudinary after a deletion request is the deletion not having
   * happened.
   *
   * Failures are logged per photo and do not stop the sweep: one unreachable
   * asset must not leave the other nine behind.
   */
  async removeAllForUser(userId: string): Promise<number> {
    if (!isValidObjectId(userId)) return 0;

    const photos = await this.photoModel
      .find({ userId: new Types.ObjectId(userId) })
      .lean<PhotoRow[]>()
      .exec();

    for (const photo of photos) {
      try {
        await this.cloudinary.deleteImage(photo.publicId);
      } catch (error) {
        this.logger.error(
          `Could not delete body photo asset ${photo.publicId}: ${(error as Error).message}`,
        );
      }
    }

    const { deletedCount } = await this.photoModel
      .deleteMany({ userId: new Types.ObjectId(userId) })
      .exec();

    return deletedCount ?? 0;
  }

  /**
   * The only place a URL comes into existence.
   *
   * A signed URL is a bearer capability that does not expire on its own, so it
   * is minted here — after the caller has already been authorised — and never
   * written to the document. Storing one would turn a revocable permission
   * into a permanent link and make `visibility` decorative.
   */
  private toView(row: PhotoRow): BodyPhotoView {
    return {
      id: row._id.toString(),
      url: this.cloudinary.signedUrl(row.publicId, row.version ?? undefined),
      pose: row.pose,
      visibility: row.visibility,
      weightKg: row.weightKg ?? null,
      note: row.note ?? null,
      takenAt: row.takenAt,
      width: row.width ?? null,
      height: row.height ?? null,
    };
  }
}
