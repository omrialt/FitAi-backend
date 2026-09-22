import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PlanAssignmentService } from './plan-assignment.service';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';
import { TrainingPlanController } from './training-plan.controller';

const TRAINER = new Types.ObjectId().toString();
const CLIENT_A = new Types.ObjectId().toString();
const CLIENT_B = new Types.ObjectId().toString();
const STRANGER = new Types.ObjectId().toString();
const TEMPLATE_ID = new Types.ObjectId().toString();

/** A stored plan, with the `toObject()` the service calls on it. */
function planDoc(over: Record<string, unknown> = {}) {
  const plan = {
    _id: new Types.ObjectId(TEMPLATE_ID),
    userId: TRAINER,
    trainerId: TRAINER,
    title: 'Upper / Lower',
    description: 'Four days',
    difficulty: 'intermediate',
    isTemplate: true,
    days: [
      {
        dayName: 'Upper A',
        dayOfWeek: 1,
        plannedDate: new Date('2026-09-01'),
        exercises: [
          {
            name: 'Bench Press',
            muscleGroup: 'chest',
            type: 'regular',
            supersetGroupId: null,
            sets: [
              {
                targetReps: 8,
                targetWeight: 60,
                // The trainer's own numbers, from when they trained it.
                performedReps: 8,
                performedWeight: 62.5,
                history: [{ date: new Date(), weight: 62.5, reps: 8 }],
              },
            ],
          },
        ],
      },
    ],
    ...over,
  };
  return { ...plan, toObject: () => plan };
}

function findChain(value: unknown) {
  const chain = {
    sort: () => chain,
    select: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(value),
  };
  return chain;
}

describe('PlanAssignmentService', () => {
  let service: PlanAssignmentService;
  let planModel: jest.Mock & {
    findById: jest.Mock;
    find: jest.Mock;
  };
  let saved: Record<string, unknown>[];
  let trainerAccess: { listClientIds: jest.Mock };

  beforeEach(async () => {
    saved = [];

    // `new this.planModel(doc)` — a constructor that records what it was
    // handed and returns something `save()`able.
    const model = jest.fn().mockImplementation((doc: Record<string, unknown>) => {
      saved.push(doc);
      return {
        save: () =>
          Promise.resolve({
            _id: new Types.ObjectId(),
            toObject: () => doc,
          }),
      };
    }) as unknown as typeof planModel;

    model.findById = jest.fn().mockReturnValue({
      exec: () => Promise.resolve(planDoc()),
    });
    model.find = jest.fn().mockReturnValue(findChain([]));
    planModel = model;

    trainerAccess = {
      listClientIds: jest.fn().mockResolvedValue([CLIENT_A, CLIENT_B]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanAssignmentService,
        { provide: getModelToken('TrainingPlan'), useValue: planModel },
        { provide: TrainerAccessService, useValue: trainerAccess },
      ],
    }).compile();

    service = module.get(PlanAssignmentService);
  });

  describe('assigning', () => {
    it('creates one plan per accepted client', async () => {
      const results = await service.assign(TEMPLATE_ID, TRAINER, [
        CLIENT_A,
        CLIENT_B,
      ]);

      expect(results.map((r) => r.status)).toEqual(['created', 'created']);
      expect(saved).toHaveLength(2);
      expect(saved.map((plan) => plan.userId)).toEqual([CLIENT_A, CLIENT_B]);
      // Every clone points back at the template it came from.
      expect(saved.every((plan) => plan.initialParentId === TEMPLATE_ID)).toBe(
        true,
      );
      expect(saved.every((plan) => plan.isTemplate === false)).toBe(true);
    });

    /**
     * The shape the whole endpoint exists for: one bad id must not cost the
     * other clients their plan, and the caller has to be able to tell which
     * rows landed.
     */
    it('skips a stranger without failing the batch', async () => {
      const results = await service.assign(TEMPLATE_ID, TRAINER, [
        CLIENT_A,
        STRANGER,
      ]);

      expect(results).toEqual([
        expect.objectContaining({ clientId: CLIENT_A, status: 'created' }),
        expect.objectContaining({
          clientId: STRANGER,
          status: 'skipped',
          reason: 'not_your_client',
        }),
      ]);
      expect(saved).toHaveLength(1);
    });

    it('skips a client who already holds this template', async () => {
      planModel.find.mockReturnValue(findChain([{ userId: CLIENT_A }]));

      const results = await service.assign(TEMPLATE_ID, TRAINER, [
        CLIENT_A,
        CLIENT_B,
      ]);

      expect(results[0]).toEqual(
        expect.objectContaining({
          clientId: CLIENT_A,
          status: 'skipped',
          reason: 'already_assigned',
        }),
      );
      expect(results[1].status).toBe('created');
    });

    it('assigns again when explicitly forced', async () => {
      planModel.find.mockReturnValue(findChain([{ userId: CLIENT_A }]));

      const results = await service.assign(
        TEMPLATE_ID,
        TRAINER,
        [CLIENT_A],
        { force: true },
      );

      expect(results[0].status).toBe('created');
    });

    it('writes one plan for a client named twice in one request', async () => {
      const results = await service.assign(TEMPLATE_ID, TRAINER, [
        CLIENT_A,
        CLIENT_A,
      ]);

      expect(results).toHaveLength(1);
      expect(saved).toHaveLength(1);
    });

    it('reports a write failure as that row, not as the request', async () => {
      const failing = jest
        .fn()
        .mockImplementationOnce((doc: Record<string, unknown>) => {
          saved.push(doc);
          return { save: () => Promise.reject(new Error('mongo is down')) };
        })
        .mockImplementation((doc: Record<string, unknown>) => {
          saved.push(doc);
          return {
            save: () =>
              Promise.resolve({ _id: new Types.ObjectId(), toObject: () => doc }),
          };
        });
      Object.assign(failing, {
        findById: planModel.findById,
        find: planModel.find,
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PlanAssignmentService,
          { provide: getModelToken('TrainingPlan'), useValue: failing },
          { provide: TrainerAccessService, useValue: trainerAccess },
        ],
      }).compile();

      const results = await module
        .get(PlanAssignmentService)
        .assign(TEMPLATE_ID, TRAINER, [CLIENT_A, CLIENT_B]);

      expect(results[0]).toEqual(
        expect.objectContaining({ status: 'failed', reason: 'write_failed' }),
      );
      // The second client still got their plan.
      expect(results[1].status).toBe('created');
    });

    /**
     * A template carries intent. Copying the numbers somebody else lifted
     * would write training history for a person who never did the session.
     */
    it('copies the targets and nothing that was performed', async () => {
      await service.assign(TEMPLATE_ID, TRAINER, [CLIENT_A]);

      const days = saved[0].days as {
        plannedDate?: unknown;
        exercises: { sets: Record<string, unknown>[] }[];
      }[];
      const set = days[0].exercises[0].sets[0];

      expect(set).toEqual({ targetReps: 8, targetWeight: 60, history: [] });
      expect(set.performedReps).toBeUndefined();
      expect(set.performedWeight).toBeUndefined();
      // A planned date is when *that* client was going to train.
      expect(days[0].plannedDate).toBeUndefined();
    });

    it("refuses to assign another trainer's template", async () => {
      planModel.findById.mockReturnValue({
        exec: () => Promise.resolve(planDoc({ userId: STRANGER })),
      });

      await expect(
        service.assign(TEMPLATE_ID, TRAINER, [CLIENT_A]),
      ).rejects.toThrow(ForbiddenException);
      expect(saved).toHaveLength(0);
    });

    it('404s on a template that does not exist, and on a malformed id', async () => {
      planModel.findById.mockReturnValue({ exec: () => Promise.resolve(null) });
      await expect(
        service.assign(TEMPLATE_ID, TRAINER, [CLIENT_A]),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.assign('not-an-id', TRAINER, [CLIENT_A]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('the library', () => {
    it('asks only for the caller’s own templates', async () => {
      planModel.find.mockReturnValue(findChain([]));

      await service.listLibrary(TRAINER);

      const [filter] = planModel.find.mock.calls[0] as [
        { userId: string; isTemplate: boolean },
      ];
      expect(filter).toEqual({ userId: TRAINER, isTemplate: true });
    });

    it('is empty for a malformed id rather than a query', async () => {
      await expect(service.listLibrary('not-an-id')).resolves.toEqual([]);
      expect(planModel.find).not.toHaveBeenCalled();
    });
  });

  describe('saving a plan as a template', () => {
    it('copies rather than flagging the original', async () => {
      const source = planDoc({ isTemplate: false });
      planModel.findById.mockReturnValue({
        exec: () => Promise.resolve(source),
      });

      await service.saveAsTemplate(TEMPLATE_ID, TRAINER, 'Beginner UL');

      // A new document was written…
      expect(saved).toHaveLength(1);
      expect(saved[0].isTemplate).toBe(true);
      expect(saved[0].title).toBe('Beginner UL');
      // …and the plan somebody is training was not touched.
      expect(source.isTemplate).toBe(false);
      // A template is on nobody's calendar.
      expect(saved[0].isActive).toBe(false);
      expect(saved[0].activeByUsers).toEqual([]);
    });

    it("refuses someone else's plan", async () => {
      planModel.findById.mockReturnValue({
        exec: () => Promise.resolve(planDoc({ userId: STRANGER })),
      });

      await expect(
        service.saveAsTemplate(TEMPLATE_ID, TRAINER),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

/**
 * Nest registers routes in declaration order, and nothing at any call site
 * reveals that — so `GET /training-plans/library` would be swallowed by
 * `@Get(':id')` and 404 as a missing plan with the id "library". The same
 * spec already guards the user controller's `me` routes.
 */
describe('TrainingPlanController route order', () => {
  it('declares the static routes before the :id route', () => {
    const methods = Object.getOwnPropertyNames(TrainingPlanController.prototype);

    expect(methods.indexOf('listLibrary')).toBeLessThan(
      methods.indexOf('findOne'),
    );
    expect(methods.indexOf('listTemplates')).toBeLessThan(
      methods.indexOf('findOne'),
    );
  });
});
