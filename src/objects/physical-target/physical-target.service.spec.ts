import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  PhysicalTargetService,
  computePercentComplete,
} from './physical-target.service';
import { PhysicalDataService } from '../physical-data/physical-data.service';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';

const OWNER = new Types.ObjectId().toString();
const STRANGER = new Types.ObjectId().toString();
const TRAINER = new Types.ObjectId().toString();
const TARGET_ID = new Types.ObjectId().toString();
const DAY_MS = 24 * 60 * 60 * 1000;

function chain(value: unknown) {
  const c = {
    select: () => c,
    sort: () => c,
    lean: () => c,
    exec: () => Promise.resolve(value),
  };
  return c;
}

describe('computePercentComplete', () => {
  it('measures the distance covered from start toward target', () => {
    expect(computePercentComplete(90, 85, 80)).toBe(50);
  });

  it('works for targets that go up as well as down', () => {
    expect(computePercentComplete(30, 33, 36)).toBe(50);
  });

  it('clamps overshoot to 100 and the wrong direction to 0', () => {
    expect(computePercentComplete(90, 78, 80)).toBe(100);
    expect(computePercentComplete(90, 95, 80)).toBe(0);
  });

  it('is 0 with no current reading, rather than a guess', () => {
    expect(computePercentComplete(90, null, 80)).toBe(0);
  });

  it('with no start, is all or nothing', () => {
    expect(computePercentComplete(null, 80, 80)).toBe(100);
    expect(computePercentComplete(null, 81, 80)).toBe(0);
  });
});

describe('PhysicalTargetService', () => {
  let service: PhysicalTargetService;
  let saved: Record<string, unknown> | null;
  let targetModel: jest.Mock & {
    find: jest.Mock;
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  let physicalData: { findLatestByUserId: jest.Mock };
  let trainerAccess: { isAcceptedTrainerOf: jest.Mock };

  beforeEach(async () => {
    saved = null;
    // `new this.physicalTargetModel(doc).save()` — the constructor is the mock.
    targetModel = Object.assign(
      jest.fn().mockImplementation((doc: Record<string, unknown>) => ({
        save: () => {
          saved = doc;
          return Promise.resolve(doc);
        },
      })),
      {
        find: jest.fn().mockReturnValue(chain([])),
        findById: jest.fn().mockReturnValue(chain({ userId: OWNER })),
        findByIdAndUpdate: jest.fn().mockReturnValue(chain({ _id: TARGET_ID })),
        findByIdAndDelete: jest.fn().mockReturnValue(chain({ _id: TARGET_ID })),
      },
    );
    physicalData = {
      findLatestByUserId: jest.fn().mockResolvedValue({
        weightKg: 90,
        measurements: { waist: 95 },
      }),
    };

    // TRAINER is OWNER's accepted trainer; nobody else is anyone's.
    trainerAccess = {
      isAcceptedTrainerOf: jest
        .fn()
        .mockImplementation((t: string, c: string) =>
          Promise.resolve(t === TRAINER && c === OWNER),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhysicalTargetService,
        { provide: getModelToken('PhysicalTarget'), useValue: targetModel },
        { provide: PhysicalDataService, useValue: physicalData },
        { provide: TrainerAccessService, useValue: trainerAccess },
      ],
    }).compile();

    service = module.get(PhysicalTargetService);
  });

  describe('create', () => {
    it('snapshots the starting values at creation, only for the metrics targeted', async () => {
      await service.create({
        userId: OWNER,
        targetDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        targetValues: { weightKg: 80, waist: 85 },
      });

      expect(saved?.startValues).toEqual({ weightKg: 90, waist: 95 });
    });

    it('leaves out a start value it has no reading for', async () => {
      await service.create({
        userId: OWNER,
        targetDate: new Date().toISOString(),
        targetValues: { weightKg: 80, arms: 40 },
      });

      expect(saved?.startValues).toEqual({ weightKg: 90 });
    });

    it('refuses a target with no metric at all', async () => {
      await expect(
        service.create({
          userId: OWNER,
          targetDate: new Date().toISOString(),
          targetValues: {},
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    const owner = { id: OWNER, role: 'user' };

    it('stamps closedAt when a target is marked achieved', async () => {
      await service.update(TARGET_ID, { status: 'achieved' }, owner);

      const [, update] = targetModel.findByIdAndUpdate.mock.calls[0] as [
        string,
        { status: string; closedAt: Date },
      ];
      expect(update.status).toBe('achieved');
      expect(update.closedAt).toBeInstanceOf(Date);
    });

    it('stamps closedAt when a target is abandoned', async () => {
      await service.update(TARGET_ID, { status: 'abandoned' }, owner);

      const [, update] = targetModel.findByIdAndUpdate.mock.calls[0] as [
        string,
        { closedAt: Date },
      ];
      expect(update.closedAt).toBeInstanceOf(Date);
    });

    it('forgets closedAt when a target is reopened', async () => {
      await service.update(TARGET_ID, { status: 'active' }, owner);

      const [, update] = targetModel.findByIdAndUpdate.mock.calls[0] as [
        string,
        { closedAt?: Date; $unset: Record<string, 1> },
      ];
      expect(update.closedAt).toBeUndefined();
      expect(update.$unset).toEqual({ closedAt: 1 });
    });

    it('leaves closedAt alone on an edit that does not touch status', async () => {
      await service.update(TARGET_ID, { name: 'Summer' }, owner);

      const [, update] = targetModel.findByIdAndUpdate.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(update).toEqual({ name: 'Summer' });
    });

    it("refuses to change someone else's target", async () => {
      await expect(
        service.update(
          TARGET_ID,
          { status: 'achieved' },
          { id: STRANGER, role: 'user' },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(targetModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it("refuses to delete someone else's target", async () => {
      await expect(
        service.remove(TARGET_ID, { id: STRANGER, role: 'trainer' }),
      ).rejects.toThrow(ForbiddenException);
      expect(targetModel.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('lets an admin delete any target', async () => {
      await service.remove(TARGET_ID, { id: STRANGER, role: 'admin' });
      expect(targetModel.findByIdAndDelete).toHaveBeenCalledWith(TARGET_ID);
    });
  });

  describe('getProgress', () => {
    it('reports closed targets too, so an achieved goal keeps its bars', async () => {
      targetModel.find.mockReturnValue(
        chain([
          {
            _id: new Types.ObjectId(TARGET_ID),
            targetDate: new Date(Date.now() - 2 * DAY_MS),
            status: 'achieved',
            targetValues: { weightKg: 80 },
            startValues: { weightKg: 100 },
          },
        ]),
      );

      const [progress] = await service.getProgress(OWNER);

      const [filter] = targetModel.find.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(filter).not.toHaveProperty('status');
      expect(progress.status).toBe('achieved');
      expect(progress.metrics).toEqual([
        {
          metric: 'weightKg',
          start: 100,
          current: 90,
          target: 80,
          percentComplete: 50,
        },
      ]);
      expect(progress.daysRemaining).toBeLessThan(0);
    });
  });

  describe('targets set by a trainer', () => {
    const trainer = { id: TRAINER, role: 'trainer' };
    const target = {
      userId: OWNER,
      targetDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      targetValues: { weightKg: 80 },
    };

    it("lets a connected trainer set one, owned by the client, from the client's numbers", async () => {
      await service.create(target, trainer);

      expect(String(saved?.userId)).toBe(OWNER);
      expect(String(saved?.createdBy)).toBe(TRAINER);
      expect(physicalData.findLatestByUserId).toHaveBeenCalledWith(OWNER);
      expect(saved?.startValues).toEqual({ weightKg: 90 });
    });

    it('records the owner as the author of their own target', async () => {
      await service.create(target, { id: OWNER, role: 'user' });
      expect(String(saved?.createdBy)).toBe(OWNER);
    });

    it("refuses a trainer who is not this client's trainer", async () => {
      await expect(
        service.create({ ...target, userId: STRANGER }, trainer),
      ).rejects.toThrow(ForbiddenException);
      expect(saved).toBeNull();
    });

    it('refuses a client setting a target for someone else', async () => {
      await expect(
        service.create(target, { id: STRANGER, role: 'user' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets the trainer change a target they set', async () => {
      targetModel.findById.mockReturnValue(
        chain({ userId: OWNER, createdBy: TRAINER }),
      );
      await service.update(TARGET_ID, { status: 'achieved' }, trainer);
      expect(targetModel.findByIdAndUpdate).toHaveBeenCalled();
    });

    it('never lets the trainer change a target the client set', async () => {
      targetModel.findById.mockReturnValue(
        chain({ userId: OWNER, createdBy: OWNER }),
      );
      await expect(
        service.update(TARGET_ID, { status: 'abandoned' }, trainer),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.remove(TARGET_ID, trainer)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('stops a trainer whose connection was revoked, even on their own target', async () => {
      targetModel.findById.mockReturnValue(
        chain({ userId: OWNER, createdBy: TRAINER }),
      );
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(false);

      await expect(service.remove(TARGET_ID, trainer)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets the client change a target their trainer set', async () => {
      targetModel.findById.mockReturnValue(
        chain({ userId: OWNER, createdBy: TRAINER }),
      );
      await service.update(
        TARGET_ID,
        { status: 'abandoned' },
        { id: OWNER, role: 'user' },
      );
      expect(targetModel.findByIdAndUpdate).toHaveBeenCalled();
    });
  });
});
