import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { z } from 'zod';

import type { FoodItem, Macros } from './food.schema';
import { CachedFood, UsdaClient } from './usda.client';
import { AnthropicService } from '../../common/anthropic/anthropic.service';

/**
 * Food lookup, and turning a sentence into logged food.
 *
 * The decision that shapes this whole file: **the model does language, USDA
 * does numbers.**
 *
 * Asking Claude "how many calories are in 150g of chicken breast" returns a
 * plausible number, and plausible is the problem. It will be close, it will
 * not be sourced, it will differ between two calls, and a user tracking a cut
 * has no way to notice any of that. So the model is given exactly one job it
 * is actually better at than a database — reading "אכלתי חזה עוף עם אורז
 * ועגבנייה" and returning three items with quantities and units — and the
 * macros come from USDA every time.
 *
 * An item the database cannot match comes back with `matched: false` and no
 * macros at all, for the client to render as a manual-entry row. That is the
 * honest failure: it is the state the user was already in before this feature
 * existed, and it is very obviously not a number.
 */

/** How stale a cached row may be before USDA is asked again. */
const CACHE_TTL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the model is allowed to return: names, amounts, units. No macros.
 * There is no field here for a calorie count, which is the strongest available
 * statement that it is not being asked for one.
 */
const parsedItemsSchema = z.object({
  items: z
    .array(
      z.object({
        /** English, because that is what the food database is indexed in. */
        query: z.string().min(1).max(120),
        /** As the user wrote it, so the meal reads back in their language. */
        label: z.string().min(1).max(120),
        quantity: z.number().positive().nullable(),
        unit: z
          .enum(['g', 'kg', 'ml', 'l', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'unit'])
          .nullable(),
      }),
    )
    .max(15),
});

const PARSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      maxItems: 15,
      items: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The food in plain English, as it would be looked up in a nutrition database. No brand unless the user named one.',
          },
          label: {
            type: 'string',
            description: "The food as the user wrote it, in their own language.",
          },
          quantity: {
            type: ['number', 'null'],
            description: 'The amount, or null if the user did not say.',
          },
          unit: {
            type: ['string', 'null'],
            enum: ['g', 'kg', 'ml', 'l', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'unit', null],
          },
        },
        required: ['query', 'label', 'quantity', 'unit'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

/** Grams per unit, where the conversion is a constant and not a density. */
const GRAMS_PER_UNIT: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.35,
  lb: 453.6,
  // Water-equivalent. Wrong for oil and for honey, right for the overwhelming
  // majority of what people log in millilitres, and flagged as an estimate.
  ml: 1,
  l: 1000,
  cup: 240,
  tbsp: 15,
  tsp: 5,
};

/** When the user says "an apple" and means one of them. */
const DEFAULT_UNIT_GRAMS = 100;

export interface FoodSearchResult extends Omit<FoodItem, 'searchTerms' | 'cachedAt'> {
  /** True when this row was answered without spending a USDA request. */
  fromCache: boolean;
}

export interface ParsedFood {
  /** What the user wrote, so the meal reads back in their own words. */
  name: string;
  quantity: number | null;
  unit: string | null;
  matched: boolean;
  /** Absent when `matched` is false. Never estimated by a model. */
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  /** Which USDA row the numbers came from, so the user can check. */
  source?: { fdcId: number; description: string; dataType: string | null };
  /** True when the grams were inferred rather than stated. */
  quantityEstimated: boolean;
}

export interface ParseResult {
  items: ParsedFood[];
  /** False when no API key is configured — the client says so rather than 503s. */
  available: boolean;
}

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  constructor(
    @InjectModel('FoodItem')
    private readonly foodModel: Model<FoodItem>,
    private readonly usda: UsdaClient,
    private readonly anthropic: AnthropicService,
  ) {}

  get searchAvailable(): boolean {
    return this.usda.enabled;
  }

  get parseAvailable(): boolean {
    // Parsing needs both: the model to read the sentence, USDA to price it.
    return this.anthropic.enabled && this.usda.enabled;
  }

  // ─── search ───────────────────────────────────────────────────

  /**
   * Cache first, USDA second.
   *
   * The cache is checked before every upstream call and the results are
   * merged rather than replaced, because the quota is hourly and shared by
   * every user at once. A dinner-time spike that exhausts it would otherwise
   * break the feature for everybody simultaneously — with the cache, the
   * common foods keep working and only genuinely new searches fail.
   */
  async search(query: string, limit = 10): Promise<FoodSearchResult[]> {
    const term = query.trim().toLowerCase();
    if (!term) return [];

    const cached = await this.searchCache(term, limit);
    if (cached.length >= limit) {
      return cached.map((food) => ({ ...food, fromCache: true }));
    }

    const fresh = await this.usda.search(term, limit);
    if (fresh.length > 0) {
      await this.cache(fresh, term);
    }

    // Cached rows lead: they are the ones previous searches already found
    // worth keeping, and merging by fdcId stops a row appearing twice.
    const seen = new Set(cached.map((food) => food.fdcId));
    const merged: FoodSearchResult[] = cached.map((food) => ({
      ...food,
      fromCache: true,
    }));

    for (const food of fresh) {
      if (seen.has(food.fdcId)) continue;
      merged.push({ ...food, fromCache: false });
      if (merged.length >= limit) break;
    }

    return merged;
  }

  private async searchCache(
    term: string,
    limit: number,
  ): Promise<CachedFood[]> {
    const fresh = new Date(Date.now() - CACHE_TTL_DAYS * DAY_MS);

    return this.foodModel
      .find({
        cachedAt: { $gte: fresh },
        $or: [
          { searchTerms: term },
          { description: new RegExp(escapeRegex(term), 'i') },
        ],
      })
      .limit(limit)
      .lean<CachedFood[]>()
      .exec();
  }

  /**
   * Writes USDA's answers to the cache, upserting on `fdcId`.
   *
   * `$addToSet` on the search term rather than `$set`: one row legitimately
   * answers several searches ("chicken breast", "עוף"), and replacing the list
   * would make the cache forget every term but the most recent one.
   *
   * Failures here are logged and swallowed. The user already has their answer
   * in hand — a cache write that fails must not turn a successful lookup into
   * an error.
   */
  private async cache(foods: CachedFood[], term: string): Promise<void> {
    try {
      await this.foodModel.bulkWrite(
        foods.map((food) => ({
          updateOne: {
            filter: { fdcId: food.fdcId },
            update: {
              $set: { ...food, cachedAt: new Date() },
              $addToSet: { searchTerms: term },
            },
            upsert: true,
          },
        })),
      );
    } catch (error) {
      this.logger.warn(`Food cache write failed: ${(error as Error).message}`);
    }
  }

  // ─── free-text logging ────────────────────────────────────────

  /**
   * "אכלתי חזה עוף עם אורז" to a list of foods with real macros.
   *
   * Two stages, deliberately separated. The model splits the sentence into
   * items, amounts and units, and translates each into an English lookup term
   * — the food database is indexed in English and the user is not writing in
   * it. Then every item is priced against USDA. The model never sees a macro
   * and is never asked for one.
   */
  async parse(text: string): Promise<ParseResult> {
    if (!this.parseAvailable) return { items: [], available: false };

    const result = await this.anthropic.complete({
      label: 'food-parse',
      jsonSchema: PARSE_JSON_SCHEMA,
      parser: parsedItemsSchema,
      maxTokens: 2000,
      effort: 'low',
      system: [
        'You split a description of a meal into individual foods.',
        '',
        'For each food give:',
        '- `query`: the food in plain English, phrased as it would be looked up in a nutrition database ("chicken breast", not "some grilled chicken I had").',
        '- `label`: the food as the user wrote it, in their own language.',
        '- `quantity` and `unit`: only if the user stated an amount. Otherwise null.',
        '',
        'Rules:',
        '- Never estimate calories, protein, carbohydrate or fat. You are not asked for them and they are not part of your answer.',
        '- Never invent an amount the user did not give. "I ate rice" has a null quantity; guessing 200g would be presented to them as a fact.',
        '- Split composite dishes into their main ingredients only when the user described them that way. "Shakshuka" is one item; "eggs and tomatoes" is two.',
        '- If the text describes no food at all, return an empty list.',
      ].join('\n'),
      prompt: text,
    });

    if (!result) return { items: [], available: true };

    // Sequential rather than parallel: each item may spend a USDA request,
    // and the quota is hourly and shared. A five-item meal firing five
    // concurrent lookups buys milliseconds and costs headroom.
    const items: ParsedFood[] = [];
    for (const item of result.data.items) {
      items.push(await this.price(item));
    }

    return { items, available: true };
  }

  private async price(item: {
    query: string;
    label: string;
    quantity: number | null;
    unit: string | null;
  }): Promise<ParsedFood> {
    const [match] = await this.search(item.query, 1);

    if (!match) {
      // No macros at all, rather than zeros. Zero is a number, and a user
      // scanning a list has no way to tell it from a real one.
      return {
        name: item.label,
        quantity: item.quantity,
        unit: item.unit,
        matched: false,
        quantityEstimated: item.quantity === null,
      };
    }

    const { grams, estimated } = this.toGrams(
      item.quantity,
      item.unit,
      match.servingSizeG ?? null,
    );

    return {
      name: item.label,
      quantity: item.quantity,
      unit: item.unit,
      matched: true,
      ...this.scale(match.per100g, grams),
      source: {
        fdcId: match.fdcId,
        description: match.description,
        dataType: match.dataType ?? null,
      },
      quantityEstimated: estimated,
    };
  }

  /**
   * An amount in grams, and whether it was inferred.
   *
   * The flag is the point. "One apple" has to become some number of grams for
   * any macro to exist at all, but the user did not say 100g and should not be
   * shown 52 calories as though they had. The client renders an estimate
   * differently, and the number stays editable.
   */
  private toGrams(
    quantity: number | null,
    unit: string | null,
    servingSizeG: number | null,
  ): { grams: number; estimated: boolean } {
    if (quantity === null) {
      return { grams: servingSizeG ?? DEFAULT_UNIT_GRAMS, estimated: true };
    }

    if (unit === null || unit === 'unit') {
      return {
        grams: quantity * (servingSizeG ?? DEFAULT_UNIT_GRAMS),
        estimated: true,
      };
    }

    const perUnit = GRAMS_PER_UNIT[unit];
    if (perUnit === undefined) {
      return { grams: quantity * DEFAULT_UNIT_GRAMS, estimated: true };
    }

    // Volume is only grams for water. Right for most of what gets logged in
    // millilitres, wrong for oil, and marked so either way.
    const estimated = ['ml', 'l', 'cup', 'tbsp', 'tsp'].includes(unit);

    return { grams: quantity * perUnit, estimated };
  }

  private scale(per100g: Macros, grams: number): Macros {
    const factor = grams / 100;
    return {
      calories: Math.round(per100g.calories * factor),
      protein: round(per100g.protein * factor),
      carbs: round(per100g.carbs * factor),
      fat: round(per100g.fat * factor),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
