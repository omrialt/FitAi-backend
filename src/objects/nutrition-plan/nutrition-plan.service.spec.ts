import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NutritionPlanService } from './nutrition-plan.service';
import { CurrentStatusService } from '../current-status/current-status.service';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';
import type { Requester } from '../../utils/ownership';

/**
 * Access control for nutrition plans.
 *
 * This module had none. Every other data controller mounted UserOwnershipGuard;
 * this one did not, and none of its by-id routes checked ownership, so any
 * authenticated account could read, edit or delete any plan by guessing or
 * observing an id. Verified against production before the fix: a client token
 * fetched a trainer's private plan and got 200 with the full document, while
 * the same account asking for that trainer's physical data got 403.
 *
 * The tests are written in *both* directions on purpose — a gate that refuses
 * everyone passes a one-sided test just as well as a correct one.
 */
describe('NutritionPlanService access control', () => {
  const owner = new Types.ObjectId().toHexString();
  const stranger = new Types.ObjectId().toHexString();
  const trainer = new Types.ObjectId().toHexString();
  const viewer = new Types.ObjectId().toHexString();
  const editor = new Types.ObjectId().toHexString();

  const asUser = (id: string): Requester => ({ id, role: 'user' });
  const asTrainer = (id: string): Requester => ({ id, role: 'trainer' });
  const asAdmin = (id: string): Requester => ({ id, role: 'admin' });

  let service: NutritionPlanService;
  let model: Record<string, jest.Mock>;
  let trainerAccess: {
    isAcceptedTrainerOf: jest.Mock;
    listClientIds: jest.Mock;
  };

  const plan = (overrides: Record<string, unknown> = {}) => ({
    _id: 'plan-1',
    userId: owner,
    sharedWith: [] as string[],
    activeByUsers: [] as string[],
    sharedAccess: [] as { userId: string; accessLevel: string }[],
    ratings: [] as unknown[],
    ...overrides,
  });

  const chain = (result: unknown) => {
    const link: Record<string, unknown> = {
      populate: () => link,
      select: () => link,
      sort: () => link,
      skip: () => link,
      limit: () => link,
      lean: () => link,
      exec: () => Promise.resolve(result),
    };
    return link;
  };

  beforeEach(async () => {
    model = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };

    trainerAccess = {
      isAcceptedTrainerOf: jest.fn().mockResolvedValue(false),
      listClientIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NutritionPlanService,
        { provide: getModelToken('NutritionPlan'), useValue: model },
        { provide: CurrentStatusService, useValue: {} },
        { provide: TrainerAccessService, useValue: trainerAccess },
      ],
    }).compile();

    service = module.get(NutritionPlanService);
  });

  describe('reading a plan by id', () => {
    it('refuses a stranger', async () => {
      model.findById.mockReturnValue(chain(plan()));

      await expect(
        service.findById('plan-1', asUser(stranger)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the owner', async () => {
      model.findById.mockReturnValue(chain(plan()));

      await expect(
        service.findById('plan-1', asUser(owner)),
      ).resolves.toBeDefined();
    });

    it('allows an admin', async () => {
      model.findById.mockReturnValue(chain(plan()));

      await expect(
        service.findById('plan-1', asAdmin(stranger)),
      ).resolves.toBeDefined();
    });

    it('allows someone the plan was shared with', async () => {
      model.findById.mockReturnValue(
        chain(
          plan({ sharedAccess: [{ userId: viewer, accessLevel: 'view' }] }),
        ),
      );

      await expect(
        service.findById('plan-1', asUser(viewer)),
      ).resolves.toBeDefined();
    });

    // N-08: the finding that started this. A coach could read their client's
    // training and measurements but got an empty nutrition screen.
    it("allows a connected trainer to read their client's plan", async () => {
      model.findById.mockReturnValue(chain(plan()));
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(true);

      await expect(
        service.findById('plan-1', asTrainer(trainer)),
      ).resolves.toBeDefined();
      expect(trainerAccess.isAcceptedTrainerOf).toHaveBeenCalledWith(
        trainer,
        owner,
      );
    });

    // The other direction: being a trainer is not itself access.
    it('refuses a trainer who does not coach this owner', async () => {
      model.findById.mockReturnValue(chain(plan()));
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(false);

      await expect(
        service.findById('plan-1', asTrainer(trainer)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('writing a plan', () => {
    it('refuses a stranger', async () => {
      model.findById.mockReturnValue(chain(plan()));

      await expect(
        service.update('plan-1', { title: 'x' }, asUser(stranger)),
      ).rejects.toThrow(ForbiddenException);
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses deletion by a stranger', async () => {
      model.findById.mockReturnValue(chain(plan()));

      await expect(service.remove('plan-1', asUser(stranger))).rejects.toThrow(
        ForbiddenException,
      );
      expect(model.findByIdAndDelete).not.toHaveBeenCalled();
    });

    it('allows the owner to delete', async () => {
      model.findById.mockReturnValue(chain(plan()));
      model.findByIdAndDelete.mockReturnValue(chain(plan()));

      await expect(
        service.remove('plan-1', asUser(owner)),
      ).resolves.toBeDefined();
    });

    // Write access is narrower than read access: this is the distinction
    // nothing else in the module enforces.
    it('refuses a view-only recipient, who can still read it', async () => {
      const shared = plan({
        sharedAccess: [{ userId: viewer, accessLevel: 'view' }],
      });
      model.findById.mockReturnValue(chain(shared));

      await expect(
        service.update('plan-1', { title: 'x' }, asUser(viewer)),
      ).rejects.toThrow(ForbiddenException);

      model.findById.mockReturnValue(chain(shared));
      await expect(
        service.findById('plan-1', asUser(viewer)),
      ).resolves.toBeDefined();
    });

    it('allows a recipient granted edit', async () => {
      model.findById.mockReturnValue(
        chain(
          plan({ sharedAccess: [{ userId: editor, accessLevel: 'edit' }] }),
        ),
      );
      model.findByIdAndUpdate.mockReturnValue(chain(plan()));

      await expect(
        service.update('plan-1', { title: 'x' }, asUser(editor)),
      ).resolves.toBeDefined();
    });

    // A trainer reads their client's data; they do not rewrite it. This mirrors
    // UserOwnershipGuard, where the trainer path is restricted to GET/HEAD.
    it("refuses a connected trainer editing their client's plan", async () => {
      model.findById.mockReturnValue(chain(plan()));
      trainerAccess.isAcceptedTrainerOf.mockResolvedValue(true);

      await expect(
        service.update('plan-1', { title: 'x' }, asTrainer(trainer)),
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses a stranger sharing someone else's plan onward", async () => {
      model.findById.mockReturnValue(chain(plan()));

      await expect(
        service.sharePlan('plan-1', [stranger], asUser(stranger)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listing plans', () => {
    /** findAll runs `find(...)` and `countDocuments(...)` on the same filter. */
    const captureFilter = async (requester: Requester) => {
      model.find.mockReturnValue(chain([]));
      model.countDocuments.mockResolvedValue(0);

      await service.findAll({}, requester.id, requester.role);

      const calls = model.find.mock.calls as unknown[][];
      return calls[0][0] as Record<string, unknown>;
    };

    it('scopes a plain user to their own plans', async () => {
      const filter = await captureFilter(asUser(owner));

      expect(filter).toEqual({ userId: new Types.ObjectId(owner) });
    });

    // N-08 proper: the trainer branch used to be byte-identical to the user
    // branch, so a coach saw only their own plans.
    it("includes a trainer's clients, not just the trainer", async () => {
      const client = new Types.ObjectId().toHexString();
      trainerAccess.listClientIds.mockResolvedValue([client]);

      const filter = await captureFilter(asTrainer(trainer));

      expect(filter).toEqual({
        $or: [
          { userId: new Types.ObjectId(trainer) },
          { userId: { $in: [new Types.ObjectId(client)] } },
        ],
      });
    });

    it('falls back to own plans when a trainer has no clients', async () => {
      trainerAccess.listClientIds.mockResolvedValue([]);

      const filter = await captureFilter(asTrainer(trainer));

      // `$in: []` matches nothing, so the trainer still sees exactly their own.
      expect(filter).toEqual({
        $or: [{ userId: new Types.ObjectId(trainer) }, { userId: { $in: [] } }],
      });
    });

    it('does not scope an admin', async () => {
      const filter = await captureFilter(asAdmin(stranger));

      expect(filter).toEqual({});
    });
  });
});
