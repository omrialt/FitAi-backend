import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import type { LoggedFood, MealLog, MealType, MealSource } from './meal-log.schema';

/**
 * Daily nutrition: what was eaten, what was targeted, what is left.
 *
 * Three decisions shape this file, and all three are about being honest when
 * the data does not support a number.
 *
 *   1. **The target is the plan's declared calories and its summed macros.**
 *      A `NutritionPlan` states `totalCalories` explicitly but has no protein,
 *      carbohydrate or fat target fields — those can only be summed from the
 *      foods it lists. Using the declared figure for calories respects a number
 *      the user typed on purpose; summing is the only option for the rest.
 *      When the two disagree the difference is *reported* rather than hidden,
 *      because a number whose origin is invisible is a number people stop
 *      trusting.
 *
 *   2. **No active plan means no target, not a zero target.** `remaining` is
 *      `null`, exactly as `adherence.percent` is `null` when no plan defines
 *      what was planned. Zero reads as failure; absent reads as "there is
 *      nothing to compare against", which is the truth.
 *
 *   3. **The day comes from the client.** See the note on `localDay` in the
 *      schema — computing it here would put the boundary in the server's
 *      timezone, which is UTC in production, and repeat N-21 in a new place.
 */

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealLogView {
  id: string;
  localDay: string;
  loggedAt: Date;
  mealType: MealType;
  source: MealSource;
  label: string | null;
  foods: LoggedFood[];
  notes: string | null;
  /** Summed from `foods`, never stored — a stored total can drift from its parts. */
  totals: Macros;
}

export interface DailyIntake {
  localDay: string;
  meals: MealLogView[];
  consumed: Macros;
  /** `null` when no nutrition plan is active. */
  target: Macros | null;
  /** `null` whenever `target` is. May go negative — see `subtract`. */
  remaining: Macros | null;
  /** Which plan supplied the target, so the number is traceable on screen. */
  planId: string | null;
  planTitle: string | null;
  /**
   * Present only when the plan's declared `totalCalories` disagrees with the
   * sum of the foods it lists. Decision 1: surface it, do not average it away.
   */
  calorieTargetMismatch: { declared: number; summed: number } | null;
}

interface PlanRow {
  _id: Types.ObjectId;
  title?: string;
  totalCalories?: number;
  meals?: { foods?: Partial<LoggedFood>[] }[];
}

interface StatusRow {
  activeMenuId?: Types.ObjectId | { _id: Types.ObjectId } | null;
}

const ZERO: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };

@Injectable()
export class MealLogService {
  constructor(
    @InjectModel('MealLog')
    private readonly mealLogModel: Model<MealLog>,
    @InjectModel('NutritionPlan')
    private readonly nutritionPlanModel: Model<unknown>,
    @InjectModel('CurrentStatus')
    private readonly currentStatusModel: Model<unknown>,
  ) {}

  async create(
    userId: string,
    input: {
      localDay: string;
      mealType: MealType;
      source?: MealSource;
      label?: string;
      foods: LoggedFood[];
      notes?: string;
      loggedAt?: Date;
    },
  ): Promise<MealLogView> {
    const created = await this.mealLogModel.create({
      userId: new Types.ObjectId(userId),
      localDay: input.localDay,
      loggedAt: input.loggedAt ?? new Date(),
      mealType: input.mealType,
      source: input.source ?? 'manual',
      label: input.label ?? null,
      foods: input.foods,
      notes: input.notes ?? null,
    });

    return this.toView(created.toObject() as MealLog & { _id: Types.ObjectId });
  }

  /**
   * Everything the dashboard needs for one day, in one round trip.
   *
   * Deliberately one call rather than three: the card shows consumed, target
   * and remaining together, and fetching them separately would let the screen
   * render a remaining figure computed against a target it had not loaded yet.
   */
  async getDay(userId: string, localDay: string): Promise<DailyIntake> {
    if (!isValidObjectId(userId)) {
      return this.emptyDay(localDay);
    }

    const objectId = new Types.ObjectId(userId);

    const [rows, plan] = await Promise.all([
      this.mealLogModel
        .find({ userId: objectId, localDay })
        .sort({ loggedAt: 1 })
        .lean<(MealLog & { _id: Types.ObjectId })[]>()
        .exec(),
      this.activePlan(userId),
    ]);

    const meals = rows.map((row) => this.toView(row));
    const consumed = meals.reduce(
      (acc, meal) => this.add(acc, meal.totals),
      { ...ZERO },
    );

    if (!plan) {
      return {
        localDay,
        meals,
        consumed,
        target: null,
        remaining: null,
        planId: null,
        planTitle: null,
        calorieTargetMismatch: null,
      };
    }

    const summed = this.sumPlanFoods(plan);
    const declared = plan.totalCalories;

    // Decision 1: declared calories win when stated; macros can only be summed.
    const target: Macros = {
      calories:
        typeof declared === 'number' && declared > 0
          ? declared
          : summed.calories,
      protein: summed.protein,
      carbs: summed.carbs,
      fat: summed.fat,
    };

    // Only a difference worth a person's attention. A plan whose foods add up
    // to within 25 kcal of its stated total is not inconsistent, it is rounded.
    const mismatch =
      typeof declared === 'number' &&
      declared > 0 &&
      summed.calories > 0 &&
      Math.abs(declared - summed.calories) > 25
        ? { declared: round(declared), summed: round(summed.calories) }
        : null;

    return {
      localDay,
      meals,
      consumed,
      target,
      remaining: this.subtract(target, consumed),
      planId: plan._id.toString(),
      planTitle: plan.title ?? null,
      calorieTargetMismatch: mismatch,
    };
  }

  async listRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<MealLogView[]> {
    if (!isValidObjectId(userId)) return [];

    const rows = await this.mealLogModel
      .find({
        userId: new Types.ObjectId(userId),
        localDay: { $gte: from, $lte: to },
      })
      .sort({ localDay: 1, loggedAt: 1 })
      .lean<(MealLog & { _id: Types.ObjectId })[]>()
      .exec();

    return rows.map((row) => this.toView(row));
  }

  /**
   * Deletes one entry.
   *
   * Scoped by `userId` in the query rather than loaded and compared, so
   * somebody else's entry is indistinguishable from a missing one and the
   * response never confirms that a given id exists. Mis-logging a meal is the
   * single most common thing that will happen here, so this is a primary path
   * rather than an afterthought.
   */
  async remove(id: string, userId: string): Promise<void> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Meal log not found');
    }

    const { deletedCount } = await this.mealLogModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        userId: new Types.ObjectId(userId),
      })
      .exec();

    if (!deletedCount) {
      throw new NotFoundException('Meal log not found');
    }
  }

  /** For the N-12 account-erasure cascade. */
  async removeAllForUser(userId: string): Promise<number> {
    if (!isValidObjectId(userId)) return 0;

    const { deletedCount } = await this.mealLogModel
      .deleteMany({ userId: new Types.ObjectId(userId) })
      .exec();

    return deletedCount ?? 0;
  }

  // ─── internals ────────────────────────────────────────────────

  /**
   * The plan the target comes from.
   *
   * Read from `CurrentStatus.activeMenuId`, which is what the dashboard
   * already treats as "the active plan" — not from `activeByUsers`, so the
   * card and this endpoint can never disagree about which plan is in force.
   */
  private async activePlan(userId: string): Promise<PlanRow | null> {
    const status = await this.currentStatusModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('activeMenuId')
      .lean<StatusRow>()
      .exec();

    const ref = status?.activeMenuId;
    if (!ref) return null;

    // The field is sometimes populated and sometimes a bare id, depending on
    // the caller — the dashboard hook handles both for the same reason.
    const planId =
      typeof ref === 'object' && '_id' in ref ? ref._id : (ref as Types.ObjectId);
    if (!planId || !isValidObjectId(planId)) return null;

    return this.nutritionPlanModel
      .findById(planId)
      .select('title totalCalories meals')
      .lean<PlanRow>()
      .exec();
  }

  private sumPlanFoods(plan: PlanRow): Macros {
    const total = { ...ZERO };

    for (const meal of plan.meals ?? []) {
      for (const food of meal.foods ?? []) {
        total.calories += food.calories ?? 0;
        total.protein += food.protein ?? 0;
        total.carbs += food.carbs ?? 0;
        total.fat += food.fat ?? 0;
      }
    }

    return this.round(total);
  }

  private toView(row: MealLog & { _id: Types.ObjectId }): MealLogView {
    return {
      id: row._id.toString(),
      localDay: row.localDay,
      loggedAt: row.loggedAt,
      mealType: row.mealType,
      source: row.source,
      label: row.label ?? null,
      foods: row.foods,
      notes: row.notes ?? null,
      totals: this.sumFoods(row.foods),
    };
  }

  private sumFoods(foods: LoggedFood[]): Macros {
    const total = { ...ZERO };

    for (const food of foods) {
      total.calories += food.calories || 0;
      total.protein += food.protein || 0;
      total.carbs += food.carbs || 0;
      total.fat += food.fat || 0;
    }

    return this.round(total);
  }

  private add(a: Macros, b: Macros): Macros {
    return this.round({
      calories: a.calories + b.calories,
      protein: a.protein + b.protein,
      carbs: a.carbs + b.carbs,
      fat: a.fat + b.fat,
    });
  }

  /**
   * Target minus consumed, **not clamped at zero**.
   *
   * Eating 300 kcal past the target is a fact worth knowing, and a card that
   * floors at zero says "0 remaining" for both the person who landed exactly on
   * their number and the person who is a thousand over. The client renders a
   * negative differently; it does not need protecting from one.
   */
  private subtract(target: Macros, consumed: Macros): Macros {
    return this.round({
      calories: target.calories - consumed.calories,
      protein: target.protein - consumed.protein,
      carbs: target.carbs - consumed.carbs,
      fat: target.fat - consumed.fat,
    });
  }

  /** Calories whole, macros to a tenth — grams of protein are not measured finer. */
  private round(m: Macros): Macros {
    return {
      calories: Math.round(m.calories),
      protein: round(m.protein),
      carbs: round(m.carbs),
      fat: round(m.fat),
    };
  }

  private emptyDay(localDay: string): DailyIntake {
    return {
      localDay,
      meals: [],
      consumed: { ...ZERO },
      target: null,
      remaining: null,
      planId: null,
      planTitle: null,
      calorieTargetMismatch: null,
    };
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
