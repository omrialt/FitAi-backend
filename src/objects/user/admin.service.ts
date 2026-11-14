import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDocument } from './user.schema';

export interface AdminUsersPage {
  items: Array<Record<string, unknown>>;
  total: number;
  page: number;
  limit: number;
}

interface GetUsersParams {
  role?: string;
  name?: string;
  page: number;
  limit: number;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel('User') private userModel: Model<UserDocument>,
    @InjectModel('TrainingPlan') private trainingPlanModel: Model<any>,
    @InjectModel('NutritionPlan') private nutritionPlanModel: Model<any>,
  ) {}

  async getUsers(params: GetUsersParams): Promise<AdminUsersPage> {
    const { role, name, page, limit } = params;
    const skip = (page - 1) * limit;

    // Build filter
    const filter: Record<string, any> = {};
    if (role) {
      filter.role = role;
    }
    if (name) {
      // Escaped and bounded (SEC-14): raw input as a pattern lets a caller
      // send a catastrophic-backtracking regex to the database.
      const term = name.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.fullName = { $regex: term, $options: 'i' };
    }

    // Get total count
    const total = await this.userModel.countDocuments(filter);

    // Get users
    const users = await this.userModel
      .find(filter)
      .select('-password')
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    // Enrich users with stats
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        const trainingPlansCount = await this.trainingPlanModel.countDocuments({
          userId: user._id,
        });
        const nutritionPlansCount =
          await this.nutritionPlanModel.countDocuments({
            userId: user._id,
          });

        return {
          ...user,
          trainingPlansCount,
          nutritionPlansCount,
        };
      }),
    );

    return {
      items: enrichedUsers,
      total,
      page,
      limit,
    };
  }
}
