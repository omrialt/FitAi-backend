import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NutritionPlan, NutritionPlanDocument } from './nutrition-plan.schema';
import {
  PaginationDto,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { handleMongoError } from '../../utils/mongo.helpers';
import { getIdString } from 'src/utils/helpers';
import { CurrentStatusService } from '../current-status/current-status.service';

@Injectable()
export class NutritionPlanService {
  constructor(
    @InjectModel('NutritionPlan')
    private nutritionPlanModel: Model<NutritionPlanDocument>,
    private currentStatusService: CurrentStatusService,
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
      filter = {
        userId: new Types.ObjectId(userId),
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

  async findById(id: string): Promise<NutritionPlanDocument> {
    try {
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
  ): Promise<NutritionPlanDocument> {
    try {
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

  async remove(id: string): Promise<NutritionPlanDocument> {
    try {
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
  ): Promise<NutritionPlanDocument> {
    try {
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
  ): Promise<NutritionPlanDocument> {
    try {
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
    userId: string,
    rating: number,
    comment?: string,
  ): Promise<NutritionPlanDocument> {
    try {
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
    userId: string,
  ): Promise<NutritionPlanDocument> {
    try {
      const plan = await this.nutritionPlanModel.findById(planId).exec();

      if (!plan) {
        throw new NotFoundException(
          `Nutrition plan with ID ${planId} not found`,
        );
      }

      // Remove user from activeByUsers in all other plans
      await this.nutritionPlanModel
        .updateMany(
          { activeByUsers: new Types.ObjectId(userId) },
          { $pull: { activeByUsers: new Types.ObjectId(userId) } },
        )
        .exec();

      // Add user to activeByUsers of the selected plan
      if (!plan.activeByUsers.some((id) => getIdString(id) === userId)) {
        plan.activeByUsers.push(new Types.ObjectId(userId) as any);
        await plan.save();
      }

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
