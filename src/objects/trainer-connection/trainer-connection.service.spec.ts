import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TrainerConnectionService } from './trainer-connection.service';

const TRAINER = 'trainer-1';
const CLIENT = 'client-1';

/** A stub connection document with a spyable save(). */
function connDoc(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: 'conn-1',
    trainerId: TRAINER,
    clientId: CLIENT,
    status: 'pending',
    initiatedBy: 'trainer',
    ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  return doc;
}

describe('TrainerConnectionService', () => {
  let service: TrainerConnectionService;
  let connectionModel: {
    findOne: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
  };
  let userModel: { findById: jest.Mock; updateOne: jest.Mock };

  beforeEach(async () => {
    connectionModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };
    userModel = { findById: jest.fn(), updateOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainerConnectionService,
        {
          provide: getModelToken('TrainerConnection'),
          useValue: connectionModel,
        },
        { provide: getModelToken('User'), useValue: userModel },
      ],
    }).compile();

    service = module.get(TrainerConnectionService);
  });

  describe('invite', () => {
    it('creates a pending invite when none exists', async () => {
      userModel.findById.mockResolvedValue({ role: 'user' });
      connectionModel.findOne.mockResolvedValue(null);
      connectionModel.create.mockResolvedValue(connDoc());

      await service.invite(TRAINER, CLIENT);

      expect(connectionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          trainerId: TRAINER,
          clientId: CLIENT,
          status: 'pending',
          initiatedBy: 'trainer',
        }),
      );
    });

    it('reactivates a previously declined pair to pending', async () => {
      userModel.findById.mockResolvedValue({ role: 'user' });
      const existing = connDoc({ status: 'declined' });
      connectionModel.findOne.mockResolvedValue(existing);

      await service.invite(TRAINER, CLIENT);

      expect(existing.status).toBe('pending');
      expect(existing.save).toHaveBeenCalled();
      expect(connectionModel.create).not.toHaveBeenCalled();
    });

    it('returns the existing invite without duplicating when already pending', async () => {
      userModel.findById.mockResolvedValue({ role: 'user' });
      const existing = connDoc({ status: 'pending' });
      connectionModel.findOne.mockResolvedValue(existing);

      await service.invite(TRAINER, CLIENT);

      expect(existing.save).not.toHaveBeenCalled();
      expect(connectionModel.create).not.toHaveBeenCalled();
    });

    it('rejects a self-invite', async () => {
      await expect(service.invite(TRAINER, TRAINER)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects inviting an admin', async () => {
      userModel.findById.mockResolvedValue({ role: 'admin' });
      await expect(service.invite(TRAINER, CLIENT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('conflicts when the pair is already accepted', async () => {
      userModel.findById.mockResolvedValue({ role: 'user' });
      connectionModel.findOne.mockResolvedValue(
        connDoc({ status: 'accepted' }),
      );
      await expect(service.invite(TRAINER, CLIENT)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('accept', () => {
    it('marks accepted and links the client to the trainer', async () => {
      const conn = connDoc({ status: 'pending' });
      connectionModel.findById.mockResolvedValue(conn);

      await service.accept('conn-1', CLIENT);

      expect(conn.status).toBe('accepted');
      expect(conn.save).toHaveBeenCalled();
      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: CLIENT },
        { $set: { trainerId: TRAINER } },
      );
    });

    it('forbids accepting an invite addressed to someone else', async () => {
      connectionModel.findById.mockResolvedValue(
        connDoc({ status: 'pending', clientId: 'someone-else' }),
      );
      await expect(service.accept('conn-1', CLIENT)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects accepting a non-pending invite', async () => {
      connectionModel.findById.mockResolvedValue(
        connDoc({ status: 'accepted' }),
      );
      await expect(service.accept('conn-1', CLIENT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s when the connection is missing', async () => {
      connectionModel.findById.mockResolvedValue(null);
      await expect(service.accept('conn-1', CLIENT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('decline', () => {
    it('marks the invite declined', async () => {
      const conn = connDoc({ status: 'pending' });
      connectionModel.findById.mockResolvedValue(conn);

      await service.decline('conn-1', CLIENT);

      expect(conn.status).toBe('declined');
      expect(conn.save).toHaveBeenCalled();
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('clears the client trainer link when an accepted connection is removed', async () => {
      const conn = connDoc({ status: 'accepted' });
      connectionModel.findById.mockResolvedValue(conn);

      await service.remove('conn-1', TRAINER);

      expect(conn.status).toBe('revoked');
      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: CLIENT, trainerId: TRAINER },
        { $set: { trainerId: null } },
      );
    });

    it('does not touch User.trainerId when a pending connection is removed', async () => {
      connectionModel.findById.mockResolvedValue(
        connDoc({ status: 'pending' }),
      );
      await service.remove('conn-1', CLIENT);
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('forbids a non-party from removing the connection', async () => {
      connectionModel.findById.mockResolvedValue(
        connDoc({ status: 'accepted' }),
      );
      await expect(service.remove('conn-1', 'stranger')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
