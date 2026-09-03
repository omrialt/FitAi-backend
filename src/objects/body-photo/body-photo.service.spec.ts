import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { BodyPhotoService } from './body-photo.service';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';

const CLIENT = new Types.ObjectId().toHexString();
const TRAINER = new Types.ObjectId().toHexString();
const STRANGER = new Types.ObjectId().toHexString();
const PHOTO_ID = new Types.ObjectId();

/** Satisfies `.find().sort().lean().exec()` and `.find().lean().exec()`. */
function chain(result: unknown) {
  const link = {
    sort: () => link,
    lean: () => link,
    exec: () => Promise.resolve(result),
  };
  return link;
}

const row = (overrides: Record<string, unknown> = {}) => ({
  _id: PHOTO_ID,
  userId: new Types.ObjectId(CLIENT),
  publicId: 'fitai/body-photos/abc',
  version: 1234,
  width: 800,
  height: 1200,
  pose: 'front',
  visibility: 'private',
  weightKg: 82,
  note: null,
  takenAt: new Date('2026-09-01'),
  ...overrides,
});

describe('BodyPhotoService', () => {
  let service: BodyPhotoService;
  let photoModel: Record<string, jest.Mock>;
  let cloudinary: Record<string, jest.Mock>;
  let trainerAccess: { isAcceptedTrainerOf: jest.Mock };

  beforeEach(async () => {
    photoModel = {
      find: jest.fn().mockReturnValue(chain([])),
      findOne: jest.fn().mockReturnValue(chain(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(chain(null)),
      create: jest.fn(),
      deleteOne: jest.fn().mockReturnValue(chain({ deletedCount: 1 })),
      deleteMany: jest.fn().mockReturnValue(chain({ deletedCount: 0 })),
    };
    cloudinary = {
      uploadPrivateImage: jest.fn().mockResolvedValue({
        publicId: 'fitai/body-photos/abc',
        version: 1234,
        width: 800,
        height: 1200,
      }),
      signedUrl: jest
        .fn()
        .mockImplementation((id: string) => `https://signed/${id}?sig=x`),
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    trainerAccess = { isAcceptedTrainerOf: jest.fn().mockResolvedValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BodyPhotoService,
        { provide: getModelToken('BodyPhoto'), useValue: photoModel },
        { provide: CloudinaryService, useValue: cloudinary },
        { provide: TrainerAccessService, useValue: trainerAccess },
      ],
    }).compile();

    service = module.get(BodyPhotoService);
  });

  const file = { mimetype: 'image/jpeg', buffer: Buffer.from('x') } as never;

  // ─── the privacy model ──────────────────────────────────────

  describe('who can see a photo', () => {
    it('shows the owner everything, shared or not', async () => {
      photoModel.find.mockReturnValue(chain([row(), row({ visibility: 'trainer' })]));

      const photos = await service.list(CLIENT, CLIENT);

      expect(photos).toHaveLength(2);
      // No visibility filter for the owner's own timeline.
      expect(photoModel.find.mock.calls[0][0]).not.toHaveProperty('visibility');
    });

    /**
     * The decision the whole feature turns on. This trainer has an accepted
     * connection — the same one that already grants them the client's
     * measurements, plans, nutrition and full workout log — and it grants them
     * nothing here. Agreeing that a coach may see your waist circumference is
     * not agreeing that they may see you in your underwear.
     */
    it('shows an accepted trainer only what was explicitly shared', async () => {
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(true);
      photoModel.find.mockReturnValue(chain([row({ visibility: 'trainer' })]));

      await service.list(CLIENT, TRAINER);

      // Filtered in the query, not after it: a private photo is never loaded
      // into an object somebody could later forget to strip.
      expect(photoModel.find.mock.calls[0][0]).toMatchObject({
        visibility: 'trainer',
      });
    });

    it('refuses someone with no coaching relationship', async () => {
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(false);

      await expect(service.list(CLIENT, STRANGER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(photoModel.find).not.toHaveBeenCalled();
    });
  });

  // ─── uploading ──────────────────────────────────────────────

  describe('uploading', () => {
    beforeEach(() => {
      photoModel.create.mockImplementation((doc: Record<string, unknown>) => ({
        toObject: () => ({ ...row(), ...doc, _id: PHOTO_ID }),
      }));
    });

    /**
     * There is no `visibility` field on the upload DTO at all, and the service
     * hard-codes `private` rather than reading one. A photo becomes shareable
     * through a deliberate second action, so there is no path that shares one
     * by accident on the way in.
     */
    it('always stores a new photo as private', async () => {
      // A caller smuggling a visibility in: the service takes a typed details
      // object with no such field, and `create` hard-codes 'private' anyway.
      const smuggled = { pose: 'front', visibility: 'trainer' } as unknown as {
        pose: 'front';
      };

      const created = await service.create(CLIENT, file, smuggled);

      expect(photoModel.create.mock.calls[0][0].visibility).toBe('private');
      expect(created.visibility).toBe('private');
    });

    it('uploads to the private folder, not the public one', async () => {
      await service.create(CLIENT, file, {});

      const [, folder] = cloudinary.uploadPrivateImage.mock.calls[0];
      expect(folder).toBe('fitai/body-photos');
      expect(folder).not.toBe('fitai/uploads');
    });

    /**
     * A stored URL is a permanent link, and a permanent link makes
     * `visibility` decorative — un-sharing would flip a flag while the last
     * copied URL kept working.
     */
    it('stores an identifier, never a URL', async () => {
      await service.create(CLIENT, file, {});

      const doc = photoModel.create.mock.calls[0][0];
      expect(doc.publicId).toBe('fitai/body-photos/abc');
      expect(JSON.stringify(doc)).not.toContain('http');
    });

    it('mints the URL per request instead', async () => {
      const created = await service.create(CLIENT, file, {});

      expect(cloudinary.signedUrl).toHaveBeenCalledWith(
        'fitai/body-photos/abc',
        1234,
      );
      expect(created.url).toContain('sig=');
    });
  });

  // ─── sharing ────────────────────────────────────────────────

  describe('sharing', () => {
    it('lets the owner share one photo', async () => {
      photoModel.findOneAndUpdate.mockReturnValue(
        chain(row({ visibility: 'trainer' })),
      );

      const updated = await service.setVisibility(
        PHOTO_ID.toHexString(),
        CLIENT,
        'trainer',
      );

      expect(updated.visibility).toBe('trainer');
    });

    /**
     * Scoped by `userId` in the query rather than loaded and compared, so
     * someone else's photo is indistinguishable from a missing one — the
     * response does not confirm that a given id exists.
     */
    it('will not let anyone share a photo that is not theirs', async () => {
      photoModel.findOneAndUpdate.mockReturnValue(chain(null));

      await expect(
        service.setVisibility(PHOTO_ID.toHexString(), STRANGER, 'trainer'),
      ).rejects.toThrow(NotFoundException);

      expect(photoModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
        userId: expect.anything(),
      });
    });

    it('rejects a malformed id without touching the database', async () => {
      await expect(
        service.setVisibility('not-an-id', CLIENT, 'trainer'),
      ).rejects.toThrow(NotFoundException);
      expect(photoModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  // ─── deleting ───────────────────────────────────────────────

  describe('deleting', () => {
    /**
     * The order matters. Row first would leave an image nobody can find in the
     * app but which anyone holding a signed URL can still fetch — and
     * "deleted" would be false in the only sense that matters here.
     */
    it('deletes the image before the row', async () => {
      photoModel.findOne.mockReturnValue(chain(row()));
      const order: string[] = [];
      cloudinary.deleteImage.mockImplementation(async () => {
        order.push('cloudinary');
      });
      photoModel.deleteOne.mockImplementation(() => {
        order.push('mongo');
        return chain({ deletedCount: 1 });
      });

      await service.remove(PHOTO_ID.toHexString(), CLIENT);

      expect(order).toEqual(['cloudinary', 'mongo']);
    });

    it('keeps the row when the image could not be deleted', async () => {
      photoModel.findOne.mockReturnValue(chain(row()));
      cloudinary.deleteImage.mockRejectedValue(new Error('cloudinary down'));

      await expect(
        service.remove(PHOTO_ID.toHexString(), CLIENT),
      ).rejects.toThrow();
      expect(photoModel.deleteOne).not.toHaveBeenCalled();
    });

    it('refuses to delete someone else’s photo', async () => {
      photoModel.findOne.mockReturnValue(chain(null));

      await expect(
        service.remove(PHOTO_ID.toHexString(), STRANGER),
      ).rejects.toThrow(NotFoundException);
      expect(cloudinary.deleteImage).not.toHaveBeenCalled();
    });
  });

  // ─── account deletion ───────────────────────────────────────

  describe('erasing everything for an account', () => {
    it('deletes every asset, then every row', async () => {
      photoModel.find.mockReturnValue(
        chain([
          row({ publicId: 'a' }),
          row({ publicId: 'b' }),
          row({ publicId: 'c' }),
        ]),
      );
      photoModel.deleteMany.mockReturnValue(chain({ deletedCount: 3 }));

      const removed = await service.removeAllForUser(CLIENT);

      expect(cloudinary.deleteImage.mock.calls.map(([id]) => id)).toEqual([
        'a',
        'b',
        'c',
      ]);
      expect(removed).toBe(3);
    });

    // One unreachable asset must not leave the other two behind.
    it('keeps going when one asset cannot be removed', async () => {
      photoModel.find.mockReturnValue(
        chain([row({ publicId: 'a' }), row({ publicId: 'b' })]),
      );
      cloudinary.deleteImage
        .mockRejectedValueOnce(new Error('gone'))
        .mockResolvedValueOnce(undefined);
      photoModel.deleteMany.mockReturnValue(chain({ deletedCount: 2 }));

      await expect(service.removeAllForUser(CLIENT)).resolves.toBe(2);
      expect(cloudinary.deleteImage).toHaveBeenCalledTimes(2);
    });
  });
});
