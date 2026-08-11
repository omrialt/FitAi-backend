import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TrainingPlanService } from './training-plan.service';
import { CurrentStatusService } from '../current-status/current-status.service';
import { CalendarSyncService } from '../calendar-sync/calendar-sync.service';
import type { Requester } from '../../utils/ownership';

/**
 * TrainingPlanService is the largest service in the app and was the one major
 * service with no coverage at all. These tests concentrate on its access
 * control, because that is the part where being wrong is a security bug rather
 * than a display bug: read access is deliberately wider than write access, and
 * nothing else in the codebase enforces that distinction.
 */
describe('TrainingPlanService', () => {
  const owner = new Types.ObjectId().toHexString();
  const trainer = new Types.ObjectId().toHexString();
  const stranger = new Types.ObjectId().toHexString();
  const viewer = new Types.ObjectId().toHexString();
  const editor = new Types.ObjectId().toHexString();

  const asUser = (id: string): Requester => ({ id, role: 'user' });
  const asAdmin = (id: string): Requester => ({ id, role: 'admin' });

  let service: TrainingPlanService;
  let trainingPlanModel: Record<string, jest.Mock>;

  /** A stored plan with the sharing fields the access rules read. */
  const plan = (overrides: Record<string, unknown> = {}) => ({
    _id: 'plan-1',
    userId: owner,
    trainerId: trainer,
    sharedWith: [] as string[],
    activeByUsers: [] as string[],
    sharedAccess: [] as { userId: string; accessLevel: string }[],
    ...overrides,
  });

  /** Satisfies `.findById().populate()...exec()` and `.select().lean().exec()`. */
  const chain = (result: unknown) => {
    const link: Record<string, unknown> = {
      populate: () => link,
      select: () => link,
      lean: () => link,
      exec: () => Promise.resolve(result),
    };
    return link;
  };

  /** A document-like value: findById(...).exec() yields these on read paths. */
  const doc = (value: Record<string, unknown>) => ({
    ...value,
    toObject: () => value,
  });

  beforeEach(async () => {
    trainingPlanModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainingPlanService,
        {
          provide: getModelToken('TrainingPlan'),
          useValue: trainingPlanModel,
        },
        { provide: CurrentStatusService, useValue: {} },
        { provide: CalendarSyncService, useValue: {} },
      ],
    }).compile();

    service = module.get(TrainingPlanService);
  });

  /** Reach the private predicates directly; they are the actual rules. */
  const rules = () =>
    service as unknown as {
      canRead: (p: unknown, r: Requester) => boolean;
      canWrite: (p: unknown, r: Requester) => boolean;
    };

  describe('canRead', () => {
    it('lets the owner read', () => {
      expect(rules().canRead(plan(), asUser(owner))).toBe(true);
    });

    it('lets the authoring trainer read', () => {
      expect(rules().canRead(plan(), asUser(trainer))).toBe(true);
    });

    it('lets an admin read', () => {
      expect(rules().canRead(plan(), asAdmin(stranger))).toBe(true);
    });

    it('lets someone the plan was shared with read', () => {
      expect(
        rules().canRead(plan({ sharedWith: [viewer] }), asUser(viewer)),
      ).toBe(true);
    });

    it('lets someone currently running the plan read', () => {
      expect(
        rules().canRead(plan({ activeByUsers: [viewer] }), asUser(viewer)),
      ).toBe(true);
    });

    it('refuses everyone else', () => {
      expect(rules().canRead(plan(), asUser(stranger))).toBe(false);
    });
  });

  describe('canWrite', () => {
    it('lets the owner write', () => {
      expect(rules().canWrite(plan(), asUser(owner))).toBe(true);
    });

    it('lets an admin write', () => {
      expect(rules().canWrite(plan(), asAdmin(stranger))).toBe(true);
    });

    it('lets a share granted edit access write', () => {
      const shared = plan({
        sharedAccess: [{ userId: editor, accessLevel: 'edit' }],
      });
      expect(rules().canWrite(shared, asUser(editor))).toBe(true);
    });

    // The distinction that matters: read access is wider than write access, so
    // being shown a plan must not imply being able to change or delete it.
    it('refuses a viewer-level share', () => {
      const shared = plan({
        sharedAccess: [{ userId: viewer, accessLevel: 'view' }],
      });

      expect(rules().canRead(shared, asUser(viewer))).toBe(true);
      expect(rules().canWrite(shared, asUser(viewer))).toBe(false);
    });

    // A trainer authored the plan and can read it, but the plan belongs to the
    // client — editing it is the client's call.
    it('refuses the authoring trainer', () => {
      expect(rules().canWrite(plan(), asUser(trainer))).toBe(false);
    });

    it('refuses someone merely running the plan', () => {
      expect(
        rules().canWrite(plan({ activeByUsers: [viewer] }), asUser(viewer)),
      ).toBe(false);
    });
  });

  describe('findById', () => {
    it('returns the plan to someone allowed to read it', async () => {
      trainingPlanModel.findById.mockReturnValue(chain(doc(plan())));

      await expect(
        service.findById('plan-1', asUser(owner)),
      ).resolves.toMatchObject({ userId: owner });
    });

    it('refuses someone with no relationship to the plan', async () => {
      trainingPlanModel.findById.mockReturnValue(chain(doc(plan())));

      await expect(
        service.findById('plan-1', asUser(stranger)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // No requester means an internal caller that has already authorized, such
    // as the sync path. It must keep working.
    it('skips the check when no requester is supplied', async () => {
      trainingPlanModel.findById.mockReturnValue(chain(doc(plan())));

      await expect(service.findById('plan-1')).resolves.toBeDefined();
    });

    it('reports a missing plan as not found', async () => {
      trainingPlanModel.findById.mockReturnValue(chain(null));

      await expect(
        service.findById('plan-1', asUser(owner)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('sharePlan', () => {
    // Sharing hands a copy of the plan to another account, so it is an
    // owner-level action — not something a viewer can pass along.
    it('refuses anyone but the owner', async () => {
      trainingPlanModel.findById.mockReturnValue(
        chain(doc(plan({ sharedWith: [viewer] }))),
      );

      await expect(
        service.sharePlan('plan-1', [stranger], asUser(viewer)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses the authoring trainer', async () => {
      trainingPlanModel.findById.mockReturnValue(chain(doc(plan())));

      await expect(
        service.sharePlan('plan-1', [stranger], asUser(trainer)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('reports a missing plan as not found', async () => {
      trainingPlanModel.findById.mockReturnValue(chain(null));

      await expect(
        service.sharePlan('plan-1', [stranger], asUser(owner)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertCanWrite', () => {
    const assert = (id: string, r: Requester) =>
      (
        service as unknown as {
          assertCanWrite: (i: string, r: Requester) => Promise<void>;
        }
      ).assertCanWrite(id, r);

    it('passes for the owner', async () => {
      trainingPlanModel.findById.mockReturnValue(chain(plan()));

      await expect(assert('plan-1', asUser(owner))).resolves.toBeUndefined();
    });

    it('rejects a viewer', async () => {
      trainingPlanModel.findById.mockReturnValue(
        chain(plan({ sharedWith: [viewer] })),
      );

      await expect(assert('plan-1', asUser(viewer))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects when the plan does not exist', async () => {
      trainingPlanModel.findById.mockReturnValue(chain(null));

      await expect(assert('plan-1', asUser(owner))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
