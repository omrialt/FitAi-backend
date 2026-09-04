import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { FoodService } from './food.service';
import { UsdaClient, CachedFood } from './usda.client';
import { AnthropicService } from '../../common/anthropic/anthropic.service';

const CHICKEN: CachedFood = {
  fdcId: 171077,
  description: 'Chicken, broilers or fryers, breast, meat only, cooked',
  brand: null,
  dataType: 'SR Legacy',
  per100g: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  servingSizeG: null,
};

const RICE: CachedFood = {
  fdcId: 168878,
  description: 'Rice, white, long-grain, cooked',
  brand: null,
  dataType: 'SR Legacy',
  per100g: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  servingSizeG: null,
};

const APPLE: CachedFood = {
  fdcId: 171688,
  description: 'Apples, raw, with skin',
  brand: null,
  dataType: 'Foundation',
  per100g: { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
  servingSizeG: 182,
};

/** Satisfies `.find().limit().lean().exec()`. */
function chain(result: unknown) {
  const link = {
    limit: () => link,
    lean: () => link,
    exec: () => Promise.resolve(result),
  };
  return link;
}

describe('FoodService', () => {
  let service: FoodService;
  let foodModel: { find: jest.Mock; bulkWrite: jest.Mock };
  let usda: { search: jest.Mock; enabled: boolean };
  let anthropic: { complete: jest.Mock; enabled: boolean };

  beforeEach(async () => {
    foodModel = {
      find: jest.fn().mockReturnValue(chain([])),
      bulkWrite: jest.fn().mockResolvedValue({}),
    };
    usda = { search: jest.fn().mockResolvedValue([]), enabled: true };
    anthropic = { complete: jest.fn().mockResolvedValue(null), enabled: true };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FoodService,
        { provide: getModelToken('FoodItem'), useValue: foodModel },
        { provide: UsdaClient, useValue: usda },
        { provide: AnthropicService, useValue: anthropic },
      ],
    }).compile();

    service = module.get(FoodService);
  });

  const cached = (rows: CachedFood[]) =>
    foodModel.find.mockReturnValue(chain(rows));

  const parsedAs = (items: unknown[]) =>
    anthropic.complete.mockResolvedValue({ data: { items }, tokensUsed: 100 });

  // ─── search ─────────────────────────────────────────────────

  describe('search', () => {
    /**
     * The quota is 1,000 requests an hour and it is shared by every user at
     * once. "Chicken breast" is the most-typed phrase in any food logger, so
     * a cache hit that still spends a request would exhaust it at dinner time
     * and break the feature for everybody simultaneously.
     */
    it('answers from the cache without touching USDA', async () => {
      cached([CHICKEN]);

      const results = await service.search('chicken breast', 1);

      expect(results[0]).toMatchObject({ fdcId: 171077, fromCache: true });
      expect(usda.search).not.toHaveBeenCalled();
    });

    it('falls through to USDA when the cache is short', async () => {
      cached([]);
      usda.search.mockResolvedValue([CHICKEN]);

      const results = await service.search('chicken breast', 5);

      expect(usda.search).toHaveBeenCalledWith('chicken breast', 5);
      expect(results[0]).toMatchObject({ fdcId: 171077, fromCache: false });
    });

    /**
     * `$addToSet` rather than `$set` on the terms: one row legitimately
     * answers several searches, and replacing the list would make the cache
     * forget every term but the most recent one.
     */
    it('remembers which term found a row, without forgetting the others', async () => {
      cached([]);
      usda.search.mockResolvedValue([CHICKEN]);

      await service.search('עוף');

      const [operations] = foodModel.bulkWrite.mock.calls[0];
      expect(operations[0].updateOne).toMatchObject({
        filter: { fdcId: 171077 },
        upsert: true,
        update: { $addToSet: { searchTerms: 'עוף' } },
      });
    });

    it('does not return the same food twice when both sources have it', async () => {
      cached([CHICKEN]);
      usda.search.mockResolvedValue([CHICKEN, RICE]);

      const results = await service.search('meal', 5);

      expect(results.map((f) => f.fdcId)).toEqual([171077, 168878]);
    });

    // The user already has their answer in hand; a cache write that fails must
    // not turn a successful lookup into an error.
    it('still returns results when the cache write fails', async () => {
      cached([]);
      usda.search.mockResolvedValue([CHICKEN]);
      foodModel.bulkWrite.mockRejectedValue(new Error('mongo down'));

      await expect(service.search('chicken')).resolves.toHaveLength(1);
    });

    it('returns nothing for an empty query without calling anyone', async () => {
      await expect(service.search('   ')).resolves.toEqual([]);
      expect(foodModel.find).not.toHaveBeenCalled();
      expect(usda.search).not.toHaveBeenCalled();
    });
  });

  // ─── free-text parsing ──────────────────────────────────────

  describe('parse', () => {
    it('needs both a model and a food database', async () => {
      usda.enabled = false;
      expect(service.parseAvailable).toBe(false);

      await expect(service.parse('chicken and rice')).resolves.toEqual({
        items: [],
        available: false,
      });
      expect(anthropic.complete).not.toHaveBeenCalled();
    });

    /**
     * The decision this whole feature is built around. The model is asked for
     * names, amounts and units — and the schema it is constrained by has no
     * field for a calorie at all, which is the strongest available statement
     * that it is not being asked to estimate one.
     */
    it('never asks the model for a macro', async () => {
      cached([CHICKEN]);
      parsedAs([{ query: 'chicken breast', label: 'חזה עוף', quantity: 150, unit: 'g' }]);

      await service.parse('אכלתי 150 גרם חזה עוף');

      const [options] = anthropic.complete.mock.calls[0];
      const schema = JSON.stringify(options.jsonSchema);

      for (const macro of ['calorie', 'protein', 'carb', 'fat']) {
        expect(schema.toLowerCase()).not.toContain(macro);
      }
      expect(options.system).toContain('Never estimate calories');
    });

    it('prices a stated amount from the database', async () => {
      cached([CHICKEN]);
      parsedAs([{ query: 'chicken breast', label: 'חזה עוף', quantity: 150, unit: 'g' }]);

      const { items } = await service.parse('אכלתי 150 גרם חזה עוף');

      expect(items[0]).toMatchObject({
        name: 'חזה עוף',
        matched: true,
        quantity: 150,
        unit: 'g',
        // 165 kcal and 31g protein per 100g, at 1.5x.
        calories: 248,
        protein: 46.5,
        quantityEstimated: false,
        source: { fdcId: 171077, dataType: 'SR Legacy' },
      });
    });

    /**
     * No macros at all, rather than zeros. Zero is a number, and a user
     * scanning a list of foods has no way to tell it from a real one — this is
     * the row the client renders as manual entry, which is exactly where they
     * were before the feature existed.
     */
    it('returns no numbers at all for a food it cannot find', async () => {
      cached([]);
      usda.search.mockResolvedValue([]);
      parsedAs([{ query: 'grandmother soup', label: 'המרק של סבתא', quantity: 1, unit: 'cup' }]);

      const { items } = await service.parse('אכלתי את המרק של סבתא');

      expect(items[0]).toMatchObject({ name: 'המרק של סבתא', matched: false });
      expect(items[0].calories).toBeUndefined();
      expect(items[0].protein).toBeUndefined();
      expect(items[0].source).toBeUndefined();
    });

    /**
     * "An apple" has to become some number of grams for a macro to exist, but
     * the user did not say 182g and must not be shown 95 calories as though
     * they had. The flag is what lets the client render it differently.
     */
    it('flags a weight it had to infer', async () => {
      cached([APPLE]);
      parsedAs([{ query: 'apple', label: 'תפוח', quantity: 1, unit: 'unit' }]);

      const { items } = await service.parse('אכלתי תפוח');

      expect(items[0]).toMatchObject({
        matched: true,
        quantityEstimated: true,
        // One USDA serving of 182g at 52 kcal/100g.
        calories: 95,
      });
    });

    it('flags a volume as estimated, since only water weighs its millilitres', async () => {
      cached([RICE]);
      parsedAs([{ query: 'rice', label: 'אורז', quantity: 1, unit: 'cup' }]);

      const { items } = await service.parse('אכלתי כוס אורז');

      expect(items[0].quantityEstimated).toBe(true);
      // 240g at 130 kcal/100g.
      expect(items[0].calories).toBe(312);
    });

    it('does not flag a weight the user actually stated', async () => {
      cached([RICE]);
      parsedAs([{ query: 'rice', label: 'אורז', quantity: 200, unit: 'g' }]);

      const { items } = await service.parse('200 גרם אורז');
      expect(items[0].quantityEstimated).toBe(false);
    });

    /**
     * The quota is hourly and shared, so a five-item meal firing five
     * concurrent lookups buys milliseconds and costs headroom everyone needs.
     */
    it('prices items one at a time rather than in a burst', async () => {
      cached([]);
      let concurrent = 0;
      let peak = 0;
      usda.search.mockImplementation(async () => {
        peak = Math.max(peak, ++concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent--;
        return [CHICKEN];
      });
      parsedAs([
        { query: 'chicken', label: 'עוף', quantity: 100, unit: 'g' },
        { query: 'rice', label: 'אורז', quantity: 100, unit: 'g' },
        { query: 'tomato', label: 'עגבנייה', quantity: 100, unit: 'g' },
      ]);

      await service.parse('עוף אורז ועגבנייה');

      expect(peak).toBe(1);
    });

    it('returns an empty list when the model gives nothing usable', async () => {
      anthropic.complete.mockResolvedValue(null);

      await expect(service.parse('...')).resolves.toEqual({
        items: [],
        available: true,
      });
    });
  });
});
