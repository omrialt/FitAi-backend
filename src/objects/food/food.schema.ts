import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

/**
 * A local cache of USDA FoodData Central rows.
 *
 * This collection is not a food database the app owns — it is a copy of the
 * answers USDA has already given, kept because the key allows 1,000 requests
 * an hour and "chicken breast" is going to be looked up by every user who ever
 * logs a meal. Without it, a moderately busy dinner time exhausts the quota
 * and the feature fails for everyone at once, which is the worst possible
 * shape for a rate limit to take.
 *
 * `fdcId` is the identity, so the cache is idempotent: the same food looked up
 * twice updates one row rather than creating two. Nothing here is user data —
 * these are public nutrition facts, shared by every account, and there is
 * deliberately no `userId`.
 *
 * Macros are stored **per 100g** and never per serving. USDA returns both, in
 * different shapes for different data types, and picking one canonical basis
 * at the edge means the quantity arithmetic in the app has exactly one form.
 * A serving size is carried alongside as a convenience, not as the unit.
 */

export const macrosSchema = z.object({
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
});

export const foodItemSchema = z.object({
  /** USDA's identifier. Stable, and the reason a re-lookup is an upsert. */
  fdcId: z.number().int().positive(),
  description: z.string().min(1).max(300),
  brand: z.string().max(200).optional().nullable(),
  /** 'Foundation', 'SR Legacy', 'Branded' — kept so the UI can say where a number came from. */
  dataType: z.string().max(60).optional().nullable(),
  per100g: macrosSchema,
  /** Grams in one serving, when USDA states one. */
  servingSizeG: z.number().positive().optional().nullable(),
  /**
   * Lowercased search terms this row has answered for, so a cache hit does not
   * require re-querying USDA to discover that "עוף" and "chicken" both lead
   * here. Appended to, never replaced.
   */
  searchTerms: z.array(z.string().max(120)).default([]),
  cachedAt: z.date().default(() => new Date()),
});

export type Macros = z.infer<typeof macrosSchema>;
export type FoodItem = z.infer<typeof foodItemSchema>;

const MacrosMongooseSchema = {
  calories: { type: Number, required: true, min: 0 },
  protein: { type: Number, required: true, min: 0 },
  carbs: { type: Number, required: true, min: 0 },
  fat: { type: Number, required: true, min: 0 },
};

export const FoodItemSchema = new Schema(
  {
    fdcId: { type: Number, required: true, unique: true, index: true },
    description: { type: String, required: true },
    brand: { type: String, default: null },
    dataType: { type: String, default: null },
    per100g: { type: MacrosMongooseSchema, required: true },
    servingSizeG: { type: Number, default: null },
    searchTerms: { type: [String], default: [] },
    cachedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, validateBeforeSave: true },
);

// The cache is searched by term before USDA is asked anything.
FoodItemSchema.index({ searchTerms: 1 });
// A plain regex over the description covers the rest; this collection is
// thousands of rows at most, so a text index would cost more than it saves.
FoodItemSchema.index({ description: 1 });

FoodItemSchema.pre('save', function (next) {
  const result = foodItemSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

export type FoodItemDocument = HydratedDocument<FoodItem>;
export type FoodItemModel = Model<FoodItemDocument>;
