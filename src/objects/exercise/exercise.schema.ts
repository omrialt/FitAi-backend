import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

/**
 * The exercise catalogue.
 *
 * Until now "chest press" and "לחיצת חזה" and "Chest Press " were three
 * different exercises, because `muscleGroup` on a training plan is a free-text
 * string the user types by hand. That makes three things impossible: grouping
 * a plan by muscle, telling a user what else trains the same muscle, and any
 * future "no bench free, give me an alternative" — all of which need a shared
 * vocabulary before they need anything else.
 *
 * The critical decision here is what this collection does NOT do: it does not
 * replace `TrainingPlan.days[].exercises[].muscleGroup`, and it does not
 * constrain it. That field stays a free string, every existing plan keeps
 * working untouched, and no migration runs over user data. The catalogue only
 * *supplies* canonical values through autocomplete. A user who trains
 * something the catalogue has never heard of types it in, exactly as before.
 *
 * `slug` is the identity, not `_id`: it lets the seed be re-run over an
 * existing collection without duplicating rows or invalidating anything that
 * referenced an exercise before.
 */

export const muscleGroupSchema = z.enum([
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'full_body',
  'cardio',
]);

export const equipmentSchema = z.enum([
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'kettlebell',
  'band',
  'other',
]);

export const exerciseSchema = z.object({
  /** Stable identity. Lowercase, hyphenated, ASCII — safe in a URL. */
  slug: z.string().min(2).max(80),
  nameEn: z.string().min(2).max(120),
  nameHe: z.string().min(2).max(120),
  primaryMuscle: muscleGroupSchema,
  secondaryMuscles: z.array(muscleGroupSchema).default([]),
  equipment: equipmentSchema,
  /**
   * Spellings people actually type, in either language. Search reads these, so
   * "פרפר" finds the cable fly without the catalogue renaming it.
   */
  aliases: z.array(z.string().max(120)).default([]),
  /** Compound lifts sort first: they are what most searches are looking for. */
  isCompound: z.boolean().default(false),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type Exercise = z.infer<typeof exerciseSchema>;
export type MuscleGroup = z.infer<typeof muscleGroupSchema>;
export type Equipment = z.infer<typeof equipmentSchema>;

export const MUSCLE_GROUPS = muscleGroupSchema.options;
export const EQUIPMENT = equipmentSchema.options;

export const ExerciseSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    nameEn: { type: String, required: true },
    nameHe: { type: String, required: true },
    primaryMuscle: { type: String, required: true, enum: MUSCLE_GROUPS },
    secondaryMuscles: { type: [String], enum: MUSCLE_GROUPS, default: [] },
    equipment: { type: String, required: true, enum: EQUIPMENT },
    aliases: { type: [String], default: [] },
    isCompound: { type: Boolean, default: false },
  },
  { timestamps: true, validateBeforeSave: true },
);

// Browsing by muscle is the second thing anyone does after searching.
ExerciseSchema.index({ primaryMuscle: 1, isCompound: -1 });
// A plain regex search over three fields; the catalogue is ~100 documents, so
// a text index would cost more to maintain than it saves.
ExerciseSchema.index({ nameEn: 1 });
ExerciseSchema.index({ nameHe: 1 });

ExerciseSchema.pre('save', function (next) {
  const result = exerciseSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

export type ExerciseDocument = HydratedDocument<Exercise>;
export type ExerciseModel = Model<ExerciseDocument>;
