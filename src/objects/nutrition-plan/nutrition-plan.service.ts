import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NutritionPlan, NutritionPlanDocument } from './nutrition-plan.schema';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResponse } from '../../interfaces/pagination.interfaces';
import { handleMongoError } from '../../utils/mongo.helpers';
// Relative, like every other import here. The `src/...` absolute form tsc
// rewrites happily but jest cannot resolve, which is why this service had no
// spec until now.
import { getIdString } from '../../utils/helpers';
import {
  isInUserList,
  isOwnerOrAdmin,
  toIdString,
  type Requester,
} from '../../utils/ownership';
import { CurrentStatusService } from '../current-status/current-status.service';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';

@Injectable()
export class NutritionPlanService {
  constructor(
    @InjectModel('NutritionPlan')
    private nutritionPlanModel: Model<NutritionPlanDocument>,
    private currentStatusService: CurrentStatusService,
    // Resolved from the @Global() TrainerAccessModule, so nutrition-plan.module
    // needs no import for this.
    private trainerAccessService: TrainerAccessService,
  ) {}

  async create(data: Partial<NutritionPlan>): Promise<NutritionPlanDocument> {
    try {
      const plan = new this.nutritionPlanModel({
        ...data,
        userId: getIdString(data.userId),
      });
      return await plan.save();
    } catch (error) {
      handleMongoError(error);
    }
  }

  async findAll(
    query: Partial<PaginationDto> = {},
    userId: string,
    userRole: string,
  ): Promise<PaginatedResponse<NutritionPlan>> {
    const { page = 1, limit = 10, sort = 'createdAt', order = 'desc' } = query;
    const skip = (page - 1) * limit;
    const sortQuery = {
      [sort]: order === 'asc' ? (1 as const) : (-1 as const),
    };

    let filter: Record<string, any> = {};
    if (userRole === 'admin') {
      filter = {};
    } else if (userRole === 'trainer') {
      // A trainer sees their own plans plus those of every client who has
      // accepted the connection. Training plans, measurements, sessions and
      // progress already resolve this way; nutrition was the one screen that
      // did not, so a trainer opening a client saw an empty nutrition tab and
      // no error — it read as a bug because it was one.
      //
      // An empty client list leaves `$in: []`, which matches nothing, so the
      // trainer correctly falls back to seeing only their own plans.
      const clientIds = await this.trainerAccessService.listClientIds(userId);

      filter = {
        $or: [
          { userId: new Types.ObjectId(userId) },
          { userId: { $in: clientIds.map((id) => new Types.ObjectId(id)) } },
        ],
      };
    } else {
      filter = {
        userId: new Types.ObjectId(userId),
      };
    }

    const [plans, total] = await Promise.all([
      this.nutritionPlanModel
        .find(filter)
        .populate('userId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.nutritionPlanModel.countDocuments(filter),
    ]);

    return {
      items: plans.map((plan) => plan.toObject()),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Read access: the owner, an admin, anyone the plan was explicitly shared
   * with, anyone currently running it, and the owner's accepted trainer.
   *
   * `requester` is required rather than optional on every method that takes
   * it. The optional form used elsewhere in this codebase fails *open* when a
   * call site forgets to pass one, and that is precisely the mistake this
   * module already made: none of these routes checked anything, so any
   * authenticated account could read, edit or delete any plan by id. Requiring
   * the argument turns that class of omission into a compile error.
   */
  private async canRead(
    plan: Pick<
      NutritionPlanDocument,
      'userId' | 'sharedWith' | 'sharedAccess' | 'activeByUsers'
    >,
    requester: Requester,
  ): Promise<boolean> {
    if (isOwnerOrAdmin(plan.userId, requester)) return true;
    if (isInUserList(plan.sharedWith, requester.id)) return true;
    if (isInUserList(plan.activeByUsers, requester.id)) return true;
    if (
      (plan.sharedAccess ?? []).some(
        (entry) => toIdString(entry?.userId) === requester.id,
      )
    ) {
      return true;
    }

    // A coach reads their client's nutrition the same way they already read
    // that client's training plans and measurements. Checked last because it
    // is the only branch that costs a query.
    const ownerId = toIdString(plan.userId);
    if (requester.role !== 'trainer' || !ownerId) return false;
    return this.trainerAccessService.isAcceptedTrainerOf(requester.id, ownerId);
  }

  /**
   * Write access is deliberately narrower than read: owner, admin, or someone
   * granted an explicit `edit` share. Being shown a plan, running it, or
   * coaching its owner does not let you rewrite or delete it — a trainer's
   * access is read-only here exactly as `UserOwnershipGuard` defines it
   * everywhere else.
   */
  private canWrite(
    plan: Pick<NutritionPlanDocument, 'userId' | 'sharedAccess'>,
    requester: Requester,
  ): boolean {
    if (isOwnerOrAdmin(plan.userId, requester)) return true;
    return (plan.sharedAccess ?? []).some(
      (entry) =>
        toIdString(entry?.userId) === requester.id &&
        entry?.accessLevel === 'edit',
    );
  }

  /**
   * Load a plan and authorize it in one step.
   *
   * Every by-id route goes through this rather than checking after its own
   * `findById`, so a new route cannot be added that reads the document without
   * deciding who may see it.
   */
  private async loadAuthorized(
    id: string,
    requester: Requester,
    mode: 'read' | 'write',
  ): Promise<NutritionPlanDocument> {
    const plan = await this.nutritionPlanModel.findById(id).exec();
    if (!plan) {
      throw new NotFoundException(`Nutrition plan with ID ${id} not found`);
    }

    const allowed =
      mode === 'write'
        ? this.canWrite(plan, requester)
        : await this.canRead(plan, requester);

    if (!allowed) {
      // 403 rather than 404, matching `assertOwnerOrAdmin`: the caller already
      // had a valid id, so hiding existence buys nothing.
      throw new ForbiddenException(
        'You do not have access to this nutrition plan',
      );
    }

    return plan;
  }

  async findById(
    id: string,
    requester: Requester,
  ): Promise<NutritionPlanDocument> {
    try {
      await this.loadAuthorized(id, requester, 'read');

      const plan = await this.nutritionPlanModel
        .findById(id)
        .populate('userId', 'fullName email')
        .populate('ratings.userId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .exec();
      if (!plan) {
        throw new NotFoundException(`Nutrition plan with ID ${id} not found`);
      }
      return plan;
    } catch (error) {
      handleMongoError(error);
    }
  }

  async findByUserId(userId: string): Promise<NutritionPlanDocument[]> {
    return this.nutritionPlanModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    id: string,
    data: Partial<NutritionPlan>,
    requester: Requester,
  ): Promise<NutritionPlanDocument> {
    try {
      await this.loadAuthorized(id, requester, 'write');

      const plan = await this.nutritionPlanModel
        .findByIdAndUpdate(id, data, {
          new: true,
          runValidators: true,
        })
        .populate('userId', 'fullName email')
        .exec();
      if (!plan) {
        throw new NotFoundException(`Nutrition plan with ID ${id} not found`);
      }
      return plan;
    } catch (error) {
      return handleMongoError(error);
    }
  }

  async remove(
    id: string,
    requester: Requester,
  ): Promise<NutritionPlanDocument> {
    try {
      await this.loadAuthorized(id, requester, 'write');

      const plan = await this.nutritionPlanModel.findByIdAndDelete(id).exec();
      if (!plan) {
        throw new NotFoundException(`Nutrition plan with ID ${id} not found`);
      }
      return plan;
    } catch (error) {
      return handleMongoError(error);
    }
  }

  async findByUserIdWithShared(
    userId: string,
  ): Promise<NutritionPlanDocument[]> {
    try {
      return await this.nutritionPlanModel
        .find({
          $or: [
            { userId: new Types.ObjectId(userId) },
            { 'sharedAccess.userId': new Types.ObjectId(userId) },
          ],
        })
        .populate('userId', 'fullName email')
        .populate('sharedAccess.userId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .sort({ createdAt: -1 })
        .exec();
    } catch (error) {
      return handleMongoError(error);
    }
  }

  async sharePlan(
    planId: string,
    userIds: string[],
    requester: Requester,
  ): Promise<NutritionPlanDocument> {
    try {
      // Sharing is a write: granting a stranger access to a plan is a change
      // to who can see it, so it needs the same authority as editing it.
      await this.loadAuthorized(planId, requester, 'write');

      const sharedAccessEntries = userIds.map((userId) => ({
        userId: new Types.ObjectId(userId),
        accessLevel: 'view',
        objectType: 'nutritionPlan',
      }));

      const plan = await this.nutritionPlanModel
        .findByIdAndUpdate(
          planId,
          { $addToSet: { sharedAccess: { $each: sharedAccessEntries } } },
          { new: true },
        )
        .populate('userId', 'fullName email')
        .populate('sharedAccess.userId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .exec();
      if (!plan) {
        throw new NotFoundException(
          `Nutrition plan with ID ${planId} not found`,
        );
      }
      return plan;
    } catch (error) {
      return handleMongoError(error);
    }
  }

  async revokeShare(
    planId: string,
    userId: string,
    requester: Requester,
  ): Promise<NutritionPlanDocument> {
    try {
      await this.loadAuthorized(planId, requester, 'write');

      const plan = await this.nutritionPlanModel
        .findByIdAndUpdate(
          planId,
          { $pull: { sharedAccess: { userId: new Types.ObjectId(userId) } } },
          { new: true },
        )
        .populate('userId', 'fullName email')
        .populate('sharedAccess.userId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .exec();
      if (!plan) {
        throw new NotFoundException(
          `Nutrition plan with ID ${planId} not found`,
        );
      }
      return plan;
    } catch (error) {
      return handleMongoError(error);
    }
  }

  async hasAccessToPlan(
    planId: string,
    currentUserId: string,
  ): Promise<boolean> {
    try {
      const plan = await this.nutritionPlanModel.findById(planId).exec();
      if (!plan) return false;
      const userIdStr = getIdString(plan.userId);
      const sharedAccessIds = (plan.sharedAccess || []).map((entry) =>
        getIdString(entry.userId),
      );
      return (
        userIdStr === currentUserId || sharedAccessIds.includes(currentUserId)
      );
    } catch (error) {
      handleMongoError(error);
    }
  }

  async addRating(
    planId: string,
    requester: Requester,
    rating: number,
    comment?: string,
  ): Promise<NutritionPlanDocument> {
    const userId = requester.id;

    try {
      // Rating a plan you cannot open would let anyone with an id enumerate
      // and score plans they were never shown.
      await this.loadAuthorized(planId, requester, 'read');

      const plan = await this.nutritionPlanModel
        .findById(planId)
        .populate('userId', 'fullName email')
        .exec();

      if (!plan) {
        throw new NotFoundException(
          `Nutrition plan with ID ${planId} not found`,
        );
      }

      // Check if user already rated this plan
      const existingRatingIndex = plan.ratings.findIndex(
        (r: NutritionPlan['ratings'][number]) =>
          getIdString(r.userId) === userId,
      );

      if (existingRatingIndex > -1) {
        // Update existing rating
        plan.ratings[existingRatingIndex].rating = rating;
        plan.ratings[existingRatingIndex].comment = comment;
        plan.ratings[existingRatingIndex].createdAt = new Date();
      } else {
        // Add new rating
        plan.ratings.push({
          userId: userId,
          rating,
          comment,
          createdAt: new Date(),
        } as NutritionPlan['ratings'][number]);
      }

      await plan.save();

      // Populate ratings with user info
      const updatedPlan = await this.nutritionPlanModel
        .findById(planId)
        .populate('userId', 'fullName email')
        .populate('ratings.userId', 'fullName email')
        .exec();

      if (!updatedPlan) {
        throw new NotFoundException(
          `Nutrition plan with ID ${planId} not found after update`,
        );
      }

      return updatedPlan;
    } catch (error) {
      handleMongoError(error);
    }
  }

  async activateNutritionPlan(
    planId: string,
    requester: Requester,
  ): Promise<NutritionPlanDocument> {
    const userId = requester.id;

    try {
      // Read access, not write: running someone else's shared plan is the
      // point of sharing. What it must not allow is activating a plan you were
      // never given.
      const plan = await this.loadAuthorized(planId, requester, 'read');

      if (!plan) {
        throw new NotFoundException(
          `Nutrition plan with ID ${planId} not found`,
        );
      }

      // First, set isActive to false for all plans owned by this user
      await this.nutritionPlanModel
        .updateMany(
          { userId: new Types.ObjectId(userId) },
          { $set: { isActive: false } },
        )
        .exec();

      // Remove user from activeByUsers in ALL plans
      await this.nutritionPlanModel
        .updateMany(
          {},
          { $pull: { activeByUsers: new Types.ObjectId(userId) } },
        )
        .exec();

      // Then set the selected plan as active and add user to activeByUsers
      await this.nutritionPlanModel
        .findByIdAndUpdate(planId, {
          $set: { isActive: true },
          $addToSet: { activeByUsers: new Types.ObjectId(userId) },
        })
        .exec();

      // Update current status with activeMenuId
      await this.currentStatusService.setActiveMenu(userId, {
        activeMenuId: planId,
      });

      // Return populated plan
      const updatedPlan = await this.nutritionPlanModel
        .findById(planId)
        .populate('userId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .exec();

      if (!updatedPlan) {
        throw new NotFoundException(
          `Nutrition plan with ID ${planId} not found after update`,
        );
      }

      return updatedPlan;
    } catch (error) {
      handleMongoError(error);
    }
  }
}
