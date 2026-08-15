import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';

import { AccountService, OWNED_BY_USER_ID } from './account.service';
import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';

/**
 * Export and erasure.
 *
 * The failure these guard against is silent and permanent: a deletion that
 * misses a collection leaves weight, body-fat and workout history attached to
 * a user id with no account behind it, and nobody finds out.
 *
 * The cascade assertions iterate the service's own exported list rather than a
 * copy, so declaring a collection and then not deleting from it fails here.
 * What no unit test can catch is a collection nobody declared at all — that
 * one is guarded by the comment on AccountModule and by the fact that the
 * module has to register a model before the service can inject it.
 */
describe('AccountService', () => {
  const userId = new Types.ObjectId().toHexString();

  const OWNED: string[] = [...OWNED_BY_USER_ID];

  let service: AccountService;
  let models: Record<string, Record<string, jest.Mock>>;
  let cloudinary: { deleteImage: jest.Mock };

  const chain = (result: unknown) => {
    const link: Record<string, unknown> = {
      select: () => link,
      lean: () => link,
      exec: () => Promise.resolve(result),
    };
    return link;
  };

  const makeModel = () => ({
    findById: jest.fn().mockReturnValue(chain({ _id: userId })),
    findByIdAndDelete: jest.fn().mockReturnValue(chain({ _id: userId })),
    find: jest.fn().mockReturnValue(chain([])),
    deleteMany: jest.fn().mockReturnValue(chain({ deletedCount: 2 })),
    updateMany: jest.fn().mockReturnValue(chain({ modifiedCount: 1 })),
  });

  beforeEach(async () => {
    models = {};
    for (const name of [...OWNED, 'User', 'TrainerConnection']) {
      models[name] = makeModel();
    }
    cloudinary = { deleteImage: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        ...Object.entries(models).map(([name, value]) => ({
          provide: getModelToken(name),
          useValue: value,
        })),
        { provide: CloudinaryService, useValue: cloudinary },
      ],
    }).compile();

    service = module.get(AccountService);
  });

  describe('deleteAccount', () => {
    it('deletes from every collection that stores user data', async () => {
      await service.deleteAccount(userId);

      for (const name of OWNED) {
        expect(models[name].deleteMany).toHaveBeenCalledWith({
          userId: new Types.ObjectId(userId),
        });
      }
    });

    // Connections name the user under trainerId or clientId, never userId, so
    // the generic loop above would silently skip them.
    it('deletes trainer connections from both sides', async () => {
      await service.deleteAccount(userId);

      expect(models.TrainerConnection.deleteMany).toHaveBeenCalledWith({
        $or: [
          { trainerId: new Types.ObjectId(userId) },
          { clientId: new Types.ObjectId(userId) },
        ],
      });
    });

    // The half that is usually forgotten: references other people hold.
    it("removes the user from other people's plans", async () => {
      await service.deleteAccount(userId);

      for (const name of ['TrainingPlan', 'NutritionPlan']) {
        const [, update] = models[name].updateMany.mock.calls[0] as [
          unknown,
          { $pull: Record<string, unknown> },
        ];
        expect(Object.keys(update.$pull).sort()).toEqual([
          'activeByUsers',
          'ratings',
          'sharedAccess',
          'sharedWith',
        ]);
      }
    });

    it('clears the trainerId pointing at a deleted trainer', async () => {
      await service.deleteAccount(userId);

      expect(models.User.updateMany).toHaveBeenCalledWith(
        { trainerId: new Types.ObjectId(userId) },
        { $set: { trainerId: null } },
      );
    });

    it('deletes the user document last, and reports what it removed', async () => {
      const report = await service.deleteAccount(userId);

      expect(models.User.findByIdAndDelete).toHaveBeenCalledWith(userId);
      expect(report.removed.User).toBe(1);
      expect(report.removed.TrainingPlan).toBe(2);
    });

    it('rejects an unknown account rather than reporting a no-op success', async () => {
      models.User.findById.mockReturnValue(chain(null));

      await expect(service.deleteAccount(userId)).rejects.toThrow(
        NotFoundException,
      );
      expect(models.TrainingPlan.deleteMany).not.toHaveBeenCalled();
    });

    it('still deletes the account when the avatar cannot be removed', async () => {
      models.User.findById.mockReturnValue(
        chain({
          _id: userId,
          avatarUrl: 'https://res.cloudinary.com/x/image/upload/v1/av/pic.jpg',
        }),
      );
      cloudinary.deleteImage.mockRejectedValue(new Error('cloudinary down'));

      await expect(service.deleteAccount(userId)).resolves.toBeDefined();
      expect(models.User.findByIdAndDelete).toHaveBeenCalled();
    });

    it('derives the cloudinary public id from the stored url', async () => {
      models.User.findById.mockReturnValue(
        chain({
          _id: userId,
          avatarUrl:
            'https://res.cloudinary.com/demo/image/upload/v1699999999/avatars/abc123.jpg',
        }),
      );

      await service.deleteAccount(userId);

      expect(cloudinary.deleteImage).toHaveBeenCalledWith('avatars/abc123');
    });
  });

  describe('exportUserData', () => {
    it('never includes the password hash', async () => {
      const selectSpy = jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve({ _id: userId }) }),
      });
      models.User.findById.mockReturnValue({ select: selectSpy });

      await service.exportUserData(userId);

      expect(selectSpy).toHaveBeenCalledWith('-password -__v');
    });

    it('includes every data collection a person would expect', async () => {
      const result = await service.exportUserData(userId);

      for (const key of [
        'trainingPlans',
        'nutritionPlans',
        'physicalData',
        'progressStats',
        'currentStatus',
        'workoutSessions',
        'aiRecommendations',
        'trainerConnections',
      ]) {
        expect(result).toHaveProperty(key);
      }
    });
  });

  describe('assertDeletionConfirmed', () => {
    const withAccount = (account: Record<string, unknown>) => {
      models.User.findById.mockReturnValue(chain(account));
    };

    it('accepts the correct password for an email account', async () => {
      const hash = await bcrypt.hash('correct-horse', 10);
      withAccount({ authProvider: 'email', password: hash, email: 'a@b.c' });

      await expect(
        service.assertDeletionConfirmed(userId, { password: 'correct-horse' }),
      ).resolves.toBeUndefined();
    });

    it('rejects a wrong password', async () => {
      const hash = await bcrypt.hash('correct-horse', 10);
      withAccount({ authProvider: 'email', password: hash, email: 'a@b.c' });

      await expect(
        service.assertDeletionConfirmed(userId, { password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a missing password rather than deleting unconfirmed', async () => {
      const hash = await bcrypt.hash('correct-horse', 10);
      withAccount({ authProvider: 'email', password: hash, email: 'a@b.c' });

      await expect(service.assertDeletionConfirmed(userId, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    // Google accounts have no password to check, so they retype their address.
    it('accepts a matching email for a google account, case-insensitively', async () => {
      withAccount({ authProvider: 'google', email: 'Person@Example.com' });

      await expect(
        service.assertDeletionConfirmed(userId, {
          email: '  person@example.com ',
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a mismatched email for a google account', async () => {
      withAccount({ authProvider: 'google', email: 'person@example.com' });

      await expect(
        service.assertDeletionConfirmed(userId, { email: 'someone@else.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
