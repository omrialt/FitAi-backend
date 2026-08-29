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
