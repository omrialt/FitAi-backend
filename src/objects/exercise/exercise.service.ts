import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';

import type { Exercise, MuscleGroup, Equipment } from './exercise.schema';

/**
 * Read-only access to the exercise catalogue.
 *
 * There is no create/update/delete here on purpose. The catalogue is content,
 * not user data: it ships with the app and changes when the seed changes, so
 * exposing writes would mean guarding them, and a per-user exercise would be a
 * different feature with different rules. Users who train something the
 * catalogue does not list still type it in freely — the plan's `muscleGroup`
 * field never stopped accepting free text.
 */

export interface ExerciseSearchOptions {
  search?: string;
  muscleGroup?: MuscleGroup;
  equipment?: Equipment;
  limit?: number;
}

/** Enough to fill an autocomplete twice over; nobody scrolls past it. */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** Anything a user might type that regex would otherwise read as syntax. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class ExerciseService {
  constructor(
    @InjectModel('Exercise')
    private readonly exerciseModel: Model<Exercise>,
  ) {}

  /**
   * Search by name in either language, or by alias.
   *
   * Substring rather than prefix: Hebrew exercise names routinely put the
   * distinguishing word last ("לחיצת חזה בשיפוע"), so a prefix match would
   * force the user to know how the catalogue chose to phrase it.
   *
   * Compound lifts sort first because a search for "press" should surface the
   * bench press above the pec deck.
   */
  async search(options: ExerciseSearchOptions = {}): Promise<Exercise[]> {
    const filter: FilterQuery<Exercise> = {};

    const term = options.search?.trim();
    if (term) {
      const pattern = new RegExp(escapeRegex(term), 'i');
      filter.$or = [
        { nameEn: pattern },
        { nameHe: pattern },
        { aliases: pattern },
      ];
    }

    if (options.muscleGroup) {
      // Secondary muscles count: a user browsing "triceps" wants the bench
      // press in the list, even though it is filed under chest.
      filter.$and = [
        {
          $or: [
            { primaryMuscle: options.muscleGroup },
            { secondaryMuscles: options.muscleGroup },
          ],
        },
      ];
    }

    if (options.equipment) {
      filter.equipment = options.equipment;
    }

    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    return this.exerciseModel
      .find(filter)
      .sort({ isCompound: -1, nameEn: 1 })
      .limit(limit)
      .lean<Exercise[]>()
      .exec();
  }

  async findBySlug(slug: string): Promise<Exercise | null> {
    return this.exerciseModel.findOne({ slug }).lean<Exercise>().exec();
  }

  /**
   * Maps a free-text exercise name from a training plan onto a catalogue row.
   *
   * Plans store whatever the user typed, so this is the bridge every
   * catalogue-powered feature has to cross. It is deliberately strict: an
   * exact name in either language, then an exact alias, then nothing. No
   * fuzzy scoring and no partial matching — offering "Barbell Row" as the
   * substitute for someone's "Row Machine" because the strings overlap is
   * worse than offering nothing, because the user cannot see why it was
   * wrong.
   *
   * The caller's contract is that `null` is normal and means "hide the
   * feature for this exercise", never "show an error".
   */
  async resolveByName(name: string): Promise<Exercise | null> {
    const term = name?.trim();
    if (!term) return null;

    // Anchored and case-insensitive: an exact string, not a substring.
    const exact = new RegExp(`^${escapeRegex(term)}$`, 'i');

    return this.exerciseModel
      .findOne({
        $or: [{ nameHe: exact }, { nameEn: exact }, { aliases: exact }],
      })
      .lean<Exercise>()
      .exec();
  }

  /**
   * Substitutes for a free-text exercise name, in one call.
   *
   * The session screen has a name and needs alternatives; making it resolve
   * first and then ask again would be two round trips on a screen used
   * between sets, with a phone on a bench.
   */
  async alternativesForName(
    name: string,
    options: { equipment?: Equipment; limit?: number } = {},
  ): Promise<{ matched: Exercise | null; alternatives: Exercise[] }> {
    const matched = await this.resolveByName(name);
    if (!matched) return { matched: null, alternatives: [] };

    const filter: FilterQuery<Exercise> = {
      slug: { $ne: matched.slug },
      primaryMuscle: matched.primaryMuscle,
    };
    if (options.equipment) filter.equipment = options.equipment;

    const alternatives = await this.exerciseModel
      .find(filter)
      .sort({ isCompound: -1, nameEn: 1 })
      .limit(Math.min(Math.max(options.limit ?? 6, 1), MAX_LIMIT))
      .lean<Exercise[]>()
      .exec();

    return { matched, alternatives };
  }

  /**
   * Other exercises that hit the same primary muscle.
   *
   * The catalogue's whole point: with a shared vocabulary this is one query,
   * where against free-text muscle groups it was not answerable at all.
   */
  async alternatives(slug: string, limit = 6): Promise<Exercise[]> {
    const exercise = await this.findBySlug(slug);
    if (!exercise) return [];

    return this.exerciseModel
      .find({
        slug: { $ne: slug },
        primaryMuscle: exercise.primaryMuscle,
      })
      .sort({ isCompound: -1, nameEn: 1 })
      .limit(Math.min(Math.max(limit, 1), MAX_LIMIT))
      .lean<Exercise[]>()
      .exec();
  }
}
