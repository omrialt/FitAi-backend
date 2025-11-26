import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  NutritionPlan,
  NutritionPlanDocument,
  Meal,
} from './nutrition-plan.schema';
import {
  PaginationDto,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import {
  CreateNutritionPlanDto,
  UpdateNutritionPlanDto,
} from '../interfaces/nutrition-plan.interfaces';
import {
  buildSortQuery,
  validateData,
  handleMongoError,
} from '../../utils/mongo.helpers';

@Injectable()
export class NutritionPlanService {
  constructor(
    @InjectModel('NutritionPlan')
    private nutritionPlanModel: Model<NutritionPlanDocument>,
  ) {}

  private handleMongoError(error: unknown): never {
    if (error instanceof Error) {
      const mongoError = error as { name?: string; code?: number };
      if (mongoError.name === 'CastError') {
        throw new BadRequestException('Invalid ID format');
      }
      if (mongoError.code === 11000) {
        throw new BadRequestException(
          'Nutrition plan with this data already exists',
        );
      }
    }
    throw error;
  }

  async create(
    createDto: CreateNutritionPlanDto,
  ): Promise<NutritionPlanDocument> {
    try {
      const plan = new this.nutritionPlanModel({
        ...createDto,
        userId: new Types.ObjectId(createDto.userId),
      });
      return await plan.save();
    } catch (error) {
      handleMongoError(error);
    }
  }

  async findAll(
    query: Partial<PaginationDto> = {},
  ): Promise<PaginatedResponse<NutritionPlan>> {
    const { page = 1, limit = 10, sort = 'createdAt', order = 'desc' } = query;
    const skip = (page - 1) * limit;
    const sortQuery = {
      [sort]: order === 'asc' ? (1 as const) : (-1 as const),
    };

    const [plans, total] = await Promise.all([
      this.nutritionPlanModel
        .find()
        .populate('userId', 'fullName email')
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.nutritionPlanModel.countDocuments(),
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
    updateDto: UpdateNutritionPlanDto,
  ): Promise<NutritionPlanDocument> {
    try {
      const plan = await this.nutritionPlanModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .populate('userId', 'fullName email')
        .exec();
      if (!plan) {
        throw new NotFoundException(`Nutrition plan with ID ${id} not found`);
      }
      return plan;
    } catch (error) {
      handleMongoError(error);
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
      handleMongoError(error);
    }
  }

  async calculateTotalCalories(meals: Meal[]): Promise<number> {
    return meals.reduce((total, meal) => {
      const mealCalories = meal.foods.reduce(
        (sum, food) => sum + food.calories,
        0,
      );
      return total + mealCalories;
    }, 0);
  }

  async calculateMacros(
    meals: Meal[],
  ): Promise<{ protein: number; carbs: number; fat: number }> {
    const totals = { protein: 0, carbs: 0, fat: 0 };

    meals.forEach((meal) => {
      meal.foods.forEach((food) => {
        totals.protein += food.protein;
        totals.carbs += food.carbs;
        totals.fat += food.fat;
      });
    });

    return totals;
  }

  async findByUserIdWithShared(userId: string): Promise<NutritionPlanDocument[]> {
    try {
      return await this.nutritionPlanModel
        .find({
          $or: [
            { userId: new Types.ObjectId(userId) },
            { sharedWith: userId },
          ],
        })
        .populate('userId', 'fullName email')
        .populate('sharedWith', 'fullName email')
        .sort({ createdAt: -1 })
        .exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  async sharePlan(
    planId: string,
    userIds: string[],
  ): Promise<NutritionPlanDocument> {
    try {
      const plan = await this.nutritionPlanModel
        .findByIdAndUpdate(
          planId,
          { $addToSet: { sharedWith: { $each: userIds } } },
          { new: true },
        )
        .populate('userId', 'fullName email')
        .populate('sharedWith', 'fullName email')
        .exec();
      if (!plan) {
        throw new NotFoundException(`Nutrition plan with ID ${planId} not found`);
      }
      return plan;
    } catch (error) {
      handleMongoError(error);
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
          { $pull: { sharedWith: userId } },
          { new: true },
        )
        .populate('userId', 'fullName email')
        .populate('sharedWith', 'fullName email')
        .exec();
      if (!plan) {
        throw new NotFoundException(`Nutrition plan with ID ${planId} not found`);
      }
      return plan;
    } catch (error) {
      handleMongoError(error);
    }
  }

  async hasAccessToPlan(
    planId: string,
    currentUserId: string,
  ): Promise<boolean> {
    try {
      const plan = await this.nutritionPlanModel.findById(planId).exec();
      if (!plan) return false;
      const userIdStr = plan.userId.toString();
      const sharedWithIds = (plan.sharedWith || []).map((id) => id.toString());
      return (
        userIdStr === currentUserId || sharedWithIds.includes(currentUserId)
      );
    } catch (error) {
      handleMongoError(error);
    }
  }
}
