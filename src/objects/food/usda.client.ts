import { Injectable, Logger } from '@nestjs/common';

import type { FoodItem, Macros } from './food.schema';

/**
 * USDA FoodData Central, reduced to the four numbers this app stores.
 *
 * Gated on `FDC_API_KEY` exactly the way the AI is gated on its key: absent
 * means the client reports itself disabled and every call returns an empty
 * list, so the feature degrades to "the cache only" rather than to a stack
 * trace. Registration is free but it is still a signup, and nothing should
 * break for a deployment that has not done one.
 *
 * The rate limit is the design constraint. 1,000 requests an hour sounds
 * generous until you notice "chicken breast" is the most-typed phrase in any
 * food logger, and that every user typing it would spend a request. Everything
 * this returns is therefore written to the local cache and answered from there
 * next time — see `FoodService`.
 */

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

/**
 * USDA nutrient identifiers. These are stable numbers, not names: the same
 * nutrient appears as "Energy", "Energy (Atwater General Factors)" and
 * "Energy (Atwater Specific Factors)" across data types, and matching on the
 * label picks a different one depending on which food you asked for.
 */
const NUTRIENT = {
  calories: 1008,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
} as const;

/**
 * Foundation and SR Legacy are laboratory-analysed whole foods — chicken,
 * rice, an apple — and are what someone logging a home-cooked meal means.
 * Branded is included last because packaged products are a real part of how
 * people eat, but it is enormous and noisy, so it never leads.
 */
const DATA_TYPES = 'Foundation,SR Legacy,Branded';

interface UsdaNutrient {
  nutrientId?: number;
  value?: number;
}

interface UsdaFood {
  fdcId: number;
  description: string;
  brandName?: string;
  brandOwner?: string;
  dataType?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: UsdaNutrient[];
}

export type CachedFood = Omit<FoodItem, 'searchTerms' | 'cachedAt'>;

@Injectable()
export class UsdaClient {
  private readonly logger = new Logger(UsdaClient.name);

  get enabled(): boolean {
    return Boolean(process.env.FDC_API_KEY?.trim());
  }

  /**
   * Searches USDA and returns rows already reduced to this app's shape.
   *
   * Never throws. A nutrition lookup failing is "we could not find that",
   * which the caller renders as an empty result and a manual-entry field —
   * the same thing the user had before this feature existed. Turning it into
   * a 500 would take a working screen away over an upstream hiccup.
   */
  async search(query: string, limit = 10): Promise<CachedFood[]> {
    const apiKey = process.env.FDC_API_KEY?.trim();
    if (!apiKey || !query.trim()) return [];

    const url = new URL(SEARCH_URL);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', query.trim());
    url.searchParams.set('pageSize', String(Math.min(Math.max(limit, 1), 25)));
    url.searchParams.set('dataType', DATA_TYPES);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        // A food lookup sits in front of a person typing. Ten seconds is
        // already longer than anyone will wait.
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status === 429) {
        // Worth its own line: this is the hourly quota, and it means the cache
        // is doing less work than it should be.
        this.logger.warn('USDA rate limit reached — serving from cache only.');
        return [];
      }

      if (!response.ok) {
        this.logger.warn(`USDA responded ${response.status} for "${query}".`);
        return [];
      }

      const body = (await response.json()) as { foods?: UsdaFood[] };

      return (body.foods ?? [])
        .map((food) => this.normalise(food))
        .filter((food): food is CachedFood => food !== null);
    } catch (error) {
      this.logger.warn(
        `USDA lookup failed for "${query}": ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * One USDA row, reduced to per-100g macros.
   *
   * Returns `null` when calories are missing. A food with no energy value is
   * not a usable row in a nutrition logger — it would render as "0 kcal",
   * which is not "unknown", it is wrong, and the user would have no way to
   * tell the difference.
   */
  private normalise(food: UsdaFood): CachedFood | null {
    const macros = this.macros(food.foodNutrients ?? []);
    if (macros === null) return null;

    return {
      fdcId: food.fdcId,
      description: food.description,
      brand: food.brandName ?? food.brandOwner ?? null,
      dataType: food.dataType ?? null,
      per100g: macros,
      // Only grams. USDA also reports servings in millilitres and in pieces,
      // and converting either into grams needs a density this does not have.
      servingSizeG:
        food.servingSizeUnit?.toLowerCase() === 'g' && food.servingSize
          ? food.servingSize
          : null,
    };
  }

  private macros(nutrients: UsdaNutrient[]): Macros | null {
    const byId = new Map(
      nutrients
        .filter((n) => typeof n.nutrientId === 'number')
        .map((n) => [n.nutrientId as number, n.value ?? 0]),
    );

    const calories = byId.get(NUTRIENT.calories);
    if (calories === undefined) return null;

    return {
      calories: round(calories),
      protein: round(byId.get(NUTRIENT.protein) ?? 0),
      carbs: round(byId.get(NUTRIENT.carbs) ?? 0),
      fat: round(byId.get(NUTRIENT.fat) ?? 0),
    };
  }
}

/** One decimal. These are grams per 100g, not measurements of anything exact. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
