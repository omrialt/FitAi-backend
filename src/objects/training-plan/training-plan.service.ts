import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, SortOrder } from 'mongoose';
import {
  TrainingPlan,
  TrainingPlanDocument,
  trainingPlanSchema,
} from './training-plan.schema';
import {
  PaginationDto,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { MongooseError } from '../interfaces/training-plan.interfaces';

@Injectable()
export class TrainingPlanService {
  constructor(
    @InjectModel('TrainingPlan')
    private trainingPlanModel: Model<TrainingPlanDocument>,
  ) {}

  private buildSortQuery(
    sort?: string,
    order: 'asc' | 'desc' = 'asc',
  ): { [key: string]: SortOrder } | undefined {
    if (!sort) return undefined;
    return { [sort]: order === 'asc' ? 1 : -1 };
  }
  private validateData(data: Partial<TrainingPlan>): Partial<TrainingPlan> {
    const result = trainingPlanSchema.partial().safeParse(data);
    if (!result.success) {
      throw new BadRequestException(
        result.error.errors.map((e) => e.message).join(', '),
      );
    }
    return result.data as Partial<TrainingPlan>;
  }

  private handleMongoError(error: unknown): never {
    if (error instanceof Error) {
      const mongoError = error as MongooseError;
      if (mongoError.name === 'CastError') {
        throw new BadRequestException('Invalid ID format');
      }
      if (mongoError.code === 11000) {
        throw new BadRequestException(
          'Training plan with this name already exists',
        );
      }
    }
    throw error;
  }

  async create(data: Partial<TrainingPlan>): Promise<TrainingPlanDocument> {
    try {
      const validatedData = this.validateData(data);
      const plan = new this.trainingPlanModel(validatedData);
      return await plan.save();
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async findAll(
    query: PaginationDto,
    userId: string,
    userRole: string,
  ): Promise<PaginatedResponse<TrainingPlan>> {
    const { page = 1, limit = 10, sort, order = 'asc' } = query;
    const skip = (page - 1) * limit;
    const sortQuery = this.buildSortQuery(sort, order);

    // Build filter based on user role
    let filter = {};
    if (userRole === 'admin') {
      // Admin can see all plans
      console.log('Admin user - fetching all training plans');
    } else if (userRole === 'trainer') {
      // Trainer can see plans they created or plans shared with them
      filter = {
        $or: [{ trainerId: userId }, { sharedWith: userId }],
      };
      console.log(
        'Trainer user - fetching plans created by or shared with:',
        userId,
      );
    } else {
      // Regular user can see plans assigned to them or shared with them
      filter = {
        $or: [{ userId: userId }, { sharedWith: userId }],
      };
      console.log(
        'Regular user - fetching plans assigned to or shared with:',
        userId,
      );
    }

    const [plans, total] = await Promise.all([
      this.trainingPlanModel
        .find(filter)
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.trainingPlanModel.countDocuments(filter),
    ]);

    console.log(
      `Found ${plans.length} training plans for user ${userId} (role: ${userRole})`,
    );

    return {
      items: plans.map((plan) => plan.toObject()),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async findById(id: string): Promise<TrainingPlan> {
    try {
      const plan = await this.trainingPlanModel.findById(id).exec();
      if (!plan) throw new NotFoundException('Training plan not found');
      return plan.toObject();
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async update(id: string, data: Partial<TrainingPlan>): Promise<TrainingPlan> {
    try {
      const validatedData = this.validateData(data);
      const updated = await this.trainingPlanModel
        .findByIdAndUpdate(id, validatedData, {
          new: true,
          runValidators: true,
        })
        .exec();
      if (!updated) throw new NotFoundException('Training plan not found');
      return updated.toObject();
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async delete(id: string): Promise<{ message: string }> {
    try {
      const deleted = await this.trainingPlanModel.findByIdAndDelete(id).exec();
      if (!deleted) throw new NotFoundException('Training plan not found');
      return { message: 'Training plan deleted successfully' };
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async findByUserIdWithShared(userId: string): Promise<TrainingPlan[]> {
    try {
      const plans = await this.trainingPlanModel
        .find({
          $or: [{ userId }, { sharedWith: userId }],
        })
        .populate('userId', 'fullName email')
        .populate('trainerId', 'fullName email')
        .populate('sharedWith', 'fullName email')
        .sort({ createdAt: -1 })
        .exec();
      return plans.map((plan) => plan.toObject());
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async sharePlan(planId: string, userIds: string[]): Promise<TrainingPlan> {
    try {
      const plan = await this.trainingPlanModel
        .findByIdAndUpdate(
          planId,
          { $addToSet: { sharedWith: { $each: userIds } } },
          { new: true },
        )
        .populate('userId', 'fullName email')
        .populate('trainerId', 'fullName email')
        .populate('sharedWith', 'fullName email')
        .exec();
      if (!plan) throw new NotFoundException('Training plan not found');
      return plan.toObject();
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async revokeShare(planId: string, userId: string): Promise<TrainingPlan> {
    try {
      const plan = await this.trainingPlanModel
        .findByIdAndUpdate(
          planId,
          { $pull: { sharedWith: userId } },
          { new: true },
        )
        .populate('userId', 'fullName email')
        .populate('trainerId', 'fullName email')
        .populate('sharedWith', 'fullName email')
        .exec();
      if (!plan) throw new NotFoundException('Training plan not found');
      return plan.toObject();
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async hasAccessToPlan(
    planId: string,
    currentUserId: string,
  ): Promise<boolean> {
    try {
      const plan = await this.trainingPlanModel.findById(planId).exec();
      if (!plan) return false;
      const userIdStr = plan.userId.toString();
      const sharedWithIds = (plan.sharedWith || []).map((id) => id.toString());
      return (
        userIdStr === currentUserId || sharedWithIds.includes(currentUserId)
      );
    } catch (error) {
      return false;
    }
  }
}
