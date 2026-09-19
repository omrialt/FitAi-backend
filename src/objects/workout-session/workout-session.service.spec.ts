import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkoutSessionService } from './workout-session.service';

const OWNER = new Types.ObjectId().toHexString();
const STRANGER = new Types.ObjectId().toHexString();
const SESSION_ID = new Types.ObjectId().toHexString();
const PLAN_ID = new Types.ObjectId().toHexString();

/** Satisfies the `.find().sort().limit().exec()` chain. */
function chain(result: unknown) {
  const link = {
    sort: () => link,
    limit: () => link,
    exec: () => Promise.resolve(result),
  };
  return link;
}

/** The document shape the service hands to `Model.create`. */
interface CreateArg {
  userId: string;
  performedAt: Date;
  source: string;
}

function sessionDoc(userId: string) {
  return {
    _id: SESSION_ID,
    userId,
    deleteOne: jest.fn().mockResolvedValue(undefined),
  };
}

describe('WorkoutSessionService', () => {
  let service: WorkoutSessionService;
  // Typed argument tuples so the assertions below can read
  // `mock.calls[0][0]` without tripping no-unsafe-member-access on `any`.
  let sessionModel: {
    create: jest.Mock<Promise<unknown>, [CreateArg]>;
    find: jest.Mock<unknown, [Record<string, unknown>]>;
    findById: jest.Mock;
    findOne: jest.Mock;
    aggregate: jest.Mock;
  };

  beforeEach(async () => {
    sessionModel = {
      create: jest
        .fn<Promise<unknown>, [CreateArg]>()
        .mockImplementation((doc) =>
          Promise.resolve({ ...doc, _id: SESSION_ID }),
        ),
      find: jest
        .fn<unknown, [Record<string, unknown>]>()
        .mockReturnValue(chain([])),
      findById: jest.fn(),
      findOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve(null) }),
      aggregate: jest.fn().mockReturnValue({ exec: () => Promise.resolve([]) }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutSessionService,
        { provide: getModelToken('WorkoutSession'), useValue: sessionModel },
      ],
    }).compile();

    service = module.get(WorkoutSessionService);
  });

  describe('create', () => {
    it('files the session against the caller, not the body', async () => {
      await service.create(OWNER, {
        exercises: [],
        // A client cannot smuggle another user in: the DTO has no userId, and
        // the service sets it from the authenticated caller.
      });

      expect(sessionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: OWNER, source: 'app' }),
      );
    });

    /**
     * The property that makes an offline queue safe to retry.
     *
     * A request can succeed on the server and still fail on the wire, and the
     * phone cannot tell the difference — so a resend must not produce a second
     * copy of a workout that already happened.
     */
    it('returns the existing session instead of duplicating a replayed clientId', async () => {
      const already = { _id: SESSION_ID, clientId: 'abcdefgh-1234' };
      sessionModel.findOne.mockReturnValue({
        exec: () => Promise.resolve(already),
      });

      const result = await service.create(OWNER, {
        exercises: [],
        clientId: 'abcdefgh-1234',
      });

      expect(result).toBe(already);
      expect(sessionModel.create).not.toHaveBeenCalled();
    });

    it('creates normally when the clientId has not been seen', async () => {
      await service.create(OWNER, {
        exercises: [],
        clientId: 'abcdefgh-1234',
      });

      expect(sessionModel.findOne).toHaveBeenCalledWith({
        userId: OWNER,
        clientId: 'abcdefgh-1234',
      });
      expect(sessionModel.create).toHaveBeenCalled();
    });

    it('does not look for a twin when no clientId was sent', async () => {
      await service.create(OWNER, { exercises: [] });
      expect(sessionModel.findOne).not.toHaveBeenCalled();
    });

    // The pre-read cannot catch two requests racing on two lambdas; the unique
    // index can, and its winner is the right answer to return.
    it('yields to the racing twin when the unique index fires', async () => {
      const winner = { _id: SESSION_ID, clientId: 'abcdefgh-1234' };
      sessionModel.create.mockRejectedValueOnce(
        Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
      );
      sessionModel.findOne
        .mockReturnValueOnce({ exec: () => Promise.resolve(null) })
        .mockReturnValueOnce({ exec: () => Promise.resolve(winner) });

      const result = await service.create(OWNER, {
        exercises: [],
        clientId: 'abcdefgh-1234',
      });

      expect(result).toBe(winner);
    });

    it('rethrows a write failure that is not a duplicate', async () => {
      sessionModel.create.mockRejectedValueOnce(new Error('disk on fire'));

      await expect(
        service.create(OWNER, { exercises: [], clientId: 'abcdefgh-1234' }),
      ).rejects.toThrow('disk on fire');
    });

    it('defaults performedAt to now when omitted', async () => {
      const before = Date.now();
      await service.create(OWNER, { exercises: [] });

      const arg = sessionModel.create.mock.calls[0][0];
      expect(arg.performedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    // A future timestamp would land outside every rolling window and could be
    // used to inflate a later one.
    it('clamps a future performedAt to now', async () => {
      const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      await service.create(OWNER, { exercises: [], performedAt: future });

      const arg = sessionModel.create.mock.calls[0][0];
      expect(arg.performedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('keeps a past performedAt so a workout can be logged late', async () => {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
      await service.create(OWNER, {
        exercises: [],
        performedAt: yesterday.toISOString(),
      });

      const arg = sessionModel.create.mock.calls[0][0];
      expect(arg.performedAt.getTime()).toBe(yesterday.getTime());
    });
  });

  describe('findByUserId', () => {
    it('filters by the supplied date range', async () => {
      await service.findByUserId(OWNER, {
        from: '2026-07-01',
        to: '2026-07-31',
      });

      const filter = sessionModel.find.mock.calls[0][0] as {
        performedAt?: { $gte?: Date; $lte?: Date };
      };

      expect(filter.performedAt?.$gte).toEqual(new Date('2026-07-01'));
      expect(filter.performedAt?.$lte).toEqual(new Date('2026-07-31'));
    });

    it('omits the date filter entirely when no range is given', async () => {
      await service.findByUserId(OWNER);

      const filter = sessionModel.find.mock.calls[0][0];
      expect(filter).toEqual({ userId: OWNER });
    });

    it('narrows to one day of one plan when asked', async () => {
      await service.findByUserId(OWNER, {
        planId: PLAN_ID,
        dayName: 'Upper A',
        limit: 1,
      });

      expect(sessionModel.find.mock.calls[0][0]).toEqual({
        userId: OWNER,
        planId: PLAN_ID,
        dayName: 'Upper A',
      });
    });
  });

  describe('ownership', () => {
    it('returns a session to its owner', async () => {
      sessionModel.findById.mockResolvedValue(sessionDoc(OWNER));
      await expect(
        service.findById(SESSION_ID, { id: OWNER }),
      ).resolves.toBeDefined();
    });

    it('forbids reading someone else’s session', async () => {
      sessionModel.findById.mockResolvedValue(sessionDoc(OWNER));
      await expect(
        service.findById(SESSION_ID, { id: STRANGER }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an admin through', async () => {
      sessionModel.findById.mockResolvedValue(sessionDoc(OWNER));
      await expect(
        service.findById(SESSION_ID, { id: STRANGER, role: 'admin' }),
      ).resolves.toBeDefined();
    });

    it('forbids deleting someone else’s session', async () => {
      const doc = sessionDoc(OWNER);
      sessionModel.findById.mockResolvedValue(doc);
      await expect(
        service.remove(SESSION_ID, { id: STRANGER }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(doc.deleteOne).not.toHaveBeenCalled();
    });

    it('404s on a missing session', async () => {
      sessionModel.findById.mockResolvedValue(null);
      await expect(
        service.findById(SESSION_ID, { id: OWNER }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // A non-ObjectId id would make Mongoose throw a CastError, which surfaces
    // as a 500 for what is really just "no such thing".
    it('404s on a malformed id instead of casting', async () => {
      await expect(
        service.findById('not-an-id', { id: OWNER }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sessionModel.findById).not.toHaveBeenCalled();
    });
  });

  describe('countWorkoutDays', () => {
    it('returns the distinct days the aggregation grouped', async () => {
      sessionModel.aggregate.mockReturnValue({
        exec: () =>
          Promise.resolve([{ _id: '2026-08-01' }, { _id: '2026-08-03' }]),
      });

      const days = await service.countWorkoutDays(OWNER, new Date(0));
      expect(days).toEqual(new Set(['2026-08-01', '2026-08-03']));
    });

    it('returns an empty set for a malformed user id', async () => {
      const days = await service.countWorkoutDays('nope', new Date(0));
      expect(days.size).toBe(0);
      expect(sessionModel.aggregate).not.toHaveBeenCalled();
    });
  });
});
