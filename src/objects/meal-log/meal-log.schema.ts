import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

/**
 * What was actually eaten.
 *
 * The app has had a training log since the workout logger shipped —
 * `WorkoutSession` records what was performed, independent of the plan that
 * prescribed it. Nutrition had only the other half: `NutritionPlan` is a
 * *template* of what to eat, and nothing recorded what was eaten. So "how many
 * calories do I have left today" was unanswerable, because there was nothing to
 * subtract from.
 *
 * This is the missing half, and it is deliberately shaped like its counterpart:
 * a log entry belongs to the user rather than to a plan, so it survives the
 * plan being edited, unshared or deleted, and a meal that was never in any plan
 * is a first-class entry rather than an exception.
 *
 * Two decisions are worth reading before changing anything here.
 *
 * **`localDay` is stored, not derived.** This is the one field that exists
 * because of a bug. N-21 counted training weeks from the Unix epoch, which
 * begins on a Thursday, so every user's week silently rolled over on the wrong
 * day. Asking the *server* what "today" means repeats that mistake in a new
 * place: production runs on Vercel in UTC, so a meal logged at 23:30 in Israel
 * would land on tomorrow. The client sends the calendar day it is actually
 * living in, and that string is what the daily totals group by. `loggedAt`
 * keeps the precise instant for ordering and for any later timeline.
 *
 * **`foods[]` reuses the nutrition plan's `foodSchema` shape exactly.** Food
 * arriving from a plan, from a USDA lookup and from someone typing numbers into
 * a form is stored identically, so nothing downstream has to know which door it
 * came through, and every screen that can already draw a food can draw these.
 */

export const mealTypeSchema = z.enum([
  'breakfast',
  'lunch',
  'dinner',
  'snack',
]);

/**
 * Where the numbers came from. Provenance, not behaviour — nothing branches on
 * it, but "did this user type these macros or did USDA supply them" is exactly
 * the question you want answerable when a total looks wrong.
 */
export const mealSourceSchema = z.enum(['plan', 'search', 'manual']);

export const foodUnitSchema = z.enum([
  'g',
  'kg',
  'ml',
  'l',
  'oz',
  'lb',
  'cup',
  'tbsp',
  'tsp',
  'unit',
]);

/** Same fields, same names, same order as `NutritionPlan`'s food. */
export const loggedFoodSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().positive().optional().nullable(),
  unit: foodUnitSchema.optional().nullable(),
  calories: z.number().nonnegative(),
  protein: z.number().nonnegative(),
  carbs: z.number().nonnegative(),
  fat: z.number().nonnegative(),
  /** USDA row this came from, when it came from one. */
  fdcId: z.number().int().positive().optional().nullable(),
});

export const mealLogSchema = z.object({
  userId: z.union([z.string(), z.object({}).passthrough()]),
  /**
   * `YYYY-MM-DD` in the *user's* timezone, sent by the client. Never computed
   * server-side — see the note above.
   */
  localDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  loggedAt: z.date().default(() => new Date()),
  mealType: mealTypeSchema,
  source: mealSourceSchema.default('manual'),
  /** Free label, e.g. the plan meal's name. Optional and never required. */
  label: z.string().max(200).optional().nullable(),
  foods: z.array(loggedFoodSchema).min(1).max(40),
  notes: z.string().max(500).optional().nullable(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type MealLog = z.infer<typeof mealLogSchema>;
export type LoggedFood = z.infer<typeof loggedFoodSchema>;
export type MealType = z.infer<typeof mealTypeSchema>;
export type MealSource = z.infer<typeof mealSourceSchema>;

export const MEAL_TYPES = mealTypeSchema.options;
export const MEAL_SOURCES = mealSourceSchema.options;
export const FOOD_UNITS = foodUnitSchema.options;

const LoggedFoodMongooseSchema = {
  name: { type: String, required: true },
  quantity: { type: Number, default: null },
  unit: { type: String, enum: [...FOOD_UNITS, null], default: null },
  calories: { type: Number, required: true, min: 0 },
  protein: { type: Number, required: true, min: 0 },
  carbs: { type: Number, required: true, min: 0 },
  fat: { type: Number, required: true, min: 0 },
  fdcId: { type: Number, default: null },
};

export const MealLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    localDay: { type: String, required: true },
    loggedAt: { type: Date, required: true, default: Date.now },
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    source: { type: String, enum: MEAL_SOURCES, default: 'manual' },
    label: { type: String, default: null },
    foods: { type: [LoggedFoodMongooseSchema], default: [] },
    notes: { type: String, default: null },
  },
  { timestamps: true, validateBeforeSave: true },
);

// The only query that runs on every dashboard load: one user, one day.
MealLogSchema.index({ userId: 1, localDay: 1 });
// History, and the account-deletion sweep.
MealLogSchema.index({ userId: 1, loggedAt: -1 });

MealLogSchema.pre('save', function (next) {
  const result = mealLogSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

export type MealLogDocument = HydratedDocument<MealLog>;
export type MealLogModel = Model<MealLogDocument>;
