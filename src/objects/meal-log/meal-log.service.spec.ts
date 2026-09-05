import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { MealLogService } from './meal-log.service';
import type { LoggedFood } from './meal-log.schema';

const USER = new Types.ObjectId().toHexString();
const PLAN_ID = new Types.ObjectId();
const LOG_ID = new Types.ObjectId();
const DAY = '2026-09-05';

/** Satisfies `.find().sort().lean().exec()` and `.findOne().select().lean().exec()`. */
function chain(result: unknown) {
  const link = {
    sort: () => link,
    select: () => link,
    lean: () => link,
    exec: () => Promise.resolve(result),
  };
  return link;
}

const food = (over: Partial<LoggedFood> = {}): LoggedFood => ({
  name: 'Chicken Breast',
  quantity: 150,
  unit: 'g',
  calories: 248,
  protein: 46.5,
  carbs: 0,
  fat: 5.4,
  fdcId: null,
  ...over,
});

const logRow = (over: Record<string, unknown> = {}) => ({
  _id: LOG_ID,
  userId: new Types.ObjectId(USER),
  localDay: DAY,
  loggedAt: new Date('2026-09-05T12:00:00Z'),
  mealType: 'lunch',
  source: 'manual',
  label: null,
  foods: [food()],
  notes: null,
  ...over,
});

/** A plan whose declared calories and summed foods agree. */
const plan = (over: Record<string, unknown> = {}) => ({
  _id: PLAN_ID,
  title: 'Cut — 2000',
  totalCalories: 2000,
  meals: [
    {
      foods: [
        { calories: 1000, protein: 100, carbs: 80, fat: 30 },
        { calories: 1000, protein: 50, carbs: 120, fat: 30 },
      ],
    },
  ],
  ...over,
});

describe('MealLogService', () => {
  let service: MealLogService;
  let mealLogModel: Record<string, jest.Mock>;
  let nutritionPlanModel: Record<string, jest.Mock>;
  let currentStatusModel: Record<string, jest.Mock>;

  beforeEach(async () => {
    mealLogModel = {
      find: jest.fn().mockReturnValue(chain([])),
      create: jest.fn(),
      deleteOne: jest.fn().mockReturnValue(chain({ deletedCount: 1 })),
      deleteMany: jest.fn().mockReturnValue(chain({ deletedCount: 0 })),
    };
    nutritionPlanModel = { findById: jest.fn().mockReturnValue(chain(null)) };
    currentStatusModel = { findOne: jest.fn().mockReturnValue(chain(null)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MealLogService,
        { provide: getModelToken('MealLog'), useValue: mealLogModel },
        {
          provide: getModelToken('NutritionPlan'),
          useValue: nutritionPlanModel,
        },
        {
          provide: getModelToken('CurrentStatus'),
          useValue: currentStatusModel,
        },
      ],
    }).compile();

    service = module.get(MealLogService);
  });

  const withMeals = (rows: unknown[]) =>
    mealLogModel.find.mockReturnValue(chain(rows));

  const withActivePlan = (p: unknown) => {
    currentStatusModel.findOne.mockReturnValue(chain({ activeMenuId: PLAN_ID }));
    nutritionPlanModel.findById.mockReturnValue(chain(p));
  };

  // ─── decision 3: what "today" means ─────────────────────────

  describe('the day boundary', () => {
    /**
     * The field that exists because of N-21. Production runs in UTC; a meal
     * logged at 23:30 in Israel must not land on tomorrow. The client says
     * which day it is living in, and nothing here second-guesses it.
     */
    it('groups by the day the client sent, not by a server-computed one', async () => {
      withMeals([logRow()]);

      await service.getDay(USER, DAY);

      expect(mealLogModel.find.mock.calls[0][0]).toMatchObject({
        localDay: DAY,
      });
    });

    it('stores the client day verbatim on create', async () => {
      mealLogModel.create.mockImplementation((doc: Record<string, unknown>) => ({
        toObject: () => ({ ...logRow(), ...doc }),
      }));

      await service.create(USER, {
        localDay: '2026-12-31',
        mealType: 'dinner',
        foods: [food()],
      });

      expect(mealLogModel.create.mock.calls[0][0].localDay).toBe('2026-12-31');
    });
  });

  // ─── decision 1: where the target comes from ────────────────

  describe('the daily target', () => {
    it('takes calories from the declared figure and macros from the foods', async () => {
      withMeals([]);
      withActivePlan(plan());

      const day = await service.getDay(USER, DAY);

      expect(day.target).toEqual({
        // Declared on the plan.
        calories: 2000,
        // Only obtainable by summing — the plan has no macro target fields.
        protein: 150,
        carbs: 200,
        fat: 60,
      });
      expect(day.planTitle).toBe('Cut — 2000');
    });

    /**
     * Decision 1's whole point: when the two disagree, say so. Hiding it leaves
     * a number on screen whose origin nobody can reconstruct.
     */
    it('reports a declared total that disagrees with the foods', async () => {
      withMeals([]);
      withActivePlan(plan({ totalCalories: 1500 }));

      const day = await service.getDay(USER, DAY);

      expect(day.target?.calories).toBe(1500);
      expect(day.calorieTargetMismatch).toEqual({
        declared: 1500,
        summed: 2000,
      });
    });

    // A plan within 25 kcal of its own foods is rounded, not inconsistent.
    it('stays quiet about a rounding-sized difference', async () => {
      withMeals([]);
      withActivePlan(plan({ totalCalories: 1990 }));

      const day = await service.getDay(USER, DAY);
      expect(day.calorieTargetMismatch).toBeNull();
    });

    it('falls back to the summed calories when none is declared', async () => {
      withMeals([]);
      withActivePlan(plan({ totalCalories: 0 }));

      const day = await service.getDay(USER, DAY);
      expect(day.target?.calories).toBe(2000);
      expect(day.calorieTargetMismatch).toBeNull();
    });
  });

  // ─── decision 2: no active plan ─────────────────────────────

  describe('with no active nutrition plan', () => {
    /**
     * `null`, not zero. Same reasoning as `adherence.percent`: 0 reads as
     * failure, absent reads as "there is nothing to compare against".
     */
    it('still counts what was eaten but offers no target or remaining', async () => {
      withMeals([logRow()]);

      const day = await service.getDay(USER, DAY);

      expect(day.consumed).toEqual({
        calories: 248,
        protein: 46.5,
        carbs: 0,
        fat: 5.4,
      });
      expect(day.target).toBeNull();
      expect(day.remaining).toBeNull();
      expect(day.planId).toBeNull();
    });

    it('treats a status with no active menu the same way', async () => {
      currentStatusModel.findOne.mockReturnValue(chain({ activeMenuId: null }));
      withMeals([]);

      const day = await service.getDay(USER, DAY);
      expect(day.target).toBeNull();
      expect(nutritionPlanModel.findById).not.toHaveBeenCalled();
    });

    it('survives an active menu whose plan has been deleted', async () => {
      currentStatusModel.findOne.mockReturnValue(chain({ activeMenuId: PLAN_ID }));
      nutritionPlanModel.findById.mockReturnValue(chain(null));
      withMeals([]);

      await expect(service.getDay(USER, DAY)).resolves.toMatchObject({
        target: null,
        remaining: null,
      });
    });
  });

  // ─── the arithmetic ─────────────────────────────────────────

  describe('consumed and remaining', () => {
    it('sums every meal in the day', async () => {
      withMeals([
        logRow({ foods: [food({ calories: 500, protein: 40, carbs: 30, fat: 15 })] }),
        logRow({ _id: new Types.ObjectId(), foods: [food({ calories: 300, protein: 20, carbs: 40, fat: 5 })] }),
      ]);
      withActivePlan(plan());

      const day = await service.getDay(USER, DAY);

      expect(day.consumed).toEqual({
        calories: 800,
        protein: 60,
        carbs: 70,
        fat: 20,
      });
      expect(day.remaining).toEqual({
        calories: 1200,
        protein: 90,
        carbs: 130,
        fat: 40,
      });
    });

    /**
     * Not clamped. "0 remaining" would read identically for someone who landed
     * exactly on their target and someone a thousand calories past it, and only
     * one of those people needs to know.
     */
    it('goes negative when the target is exceeded', async () => {
      withMeals([
        logRow({ foods: [food({ calories: 2300, protein: 170, carbs: 210, fat: 70 })] }),
      ]);
      withActivePlan(plan());

      const day = await service.getDay(USER, DAY);

      expect(day.remaining).toEqual({
        calories: -300,
        protein: -20,
        carbs: -10,
        fat: -10,
      });
    });

    // A stored total can drift from the parts it was computed from.
    it('derives each meal total from its foods rather than storing one', async () => {
      withMeals([
        logRow({
          foods: [
            food({ calories: 100, protein: 10, carbs: 5, fat: 2 }),
            food({ calories: 250, protein: 5, carbs: 40, fat: 8 }),
          ],
        }),
      ]);

      const day = await service.getDay(USER, DAY);
      expect(day.meals[0].totals).toEqual({
        calories: 350,
        protein: 15,
        carbs: 45,
        fat: 10,
      });
    });

    it('returns an empty day for an invalid user id without querying', async () => {
      const day = await service.getDay('not-an-id', DAY);

      expect(day.meals).toEqual([]);
      expect(day.consumed).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
      expect(mealLogModel.find).not.toHaveBeenCalled();
    });
  });

  // ─── deleting ───────────────────────────────────────────────

  describe('deleting an entry', () => {
    it('scopes the delete to the owner', async () => {
      await service.remove(LOG_ID.toHexString(), USER);

      expect(mealLogModel.deleteOne.mock.calls[0][0]).toMatchObject({
        userId: expect.anything(),
        _id: expect.anything(),
      });
    });

    // Someone else's entry is indistinguishable from a missing one.
    it('reports not-found rather than forbidden for another user’s entry', async () => {
      mealLogModel.deleteOne.mockReturnValue(chain({ deletedCount: 0 }));

      await expect(
        service.remove(LOG_ID.toHexString(), USER),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a malformed id without touching the database', async () => {
      await expect(service.remove('nope', USER)).rejects.toThrow(
        NotFoundException,
      );
      expect(mealLogModel.deleteOne).not.toHaveBeenCalled();
    });
  });
});
