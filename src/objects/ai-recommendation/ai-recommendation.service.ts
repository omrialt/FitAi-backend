import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AiRecommendation,
  AiRecommendationDocument,
  RecommendationCategory,
} from './ai-recommendation.schema';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResponse } from '../../interfaces/pagination.interfaces';
import {
  CreateAiRecommendationDto,
  UpdateAiRecommendationDto,
} from '../../interfaces/ai-recommendation.interfaces';
import { handleMongoError } from '../../utils/mongo.helpers';
import { assertOwnerOrAdmin, type Requester } from '../../utils/ownership';

@Injectable()
export class AiRecommendationService {
  constructor(
    @InjectModel('AiRecommendation')
    private aiRecommendationModel: Model<AiRecommendationDocument>,
  ) {}

  async create(
    createDto: CreateAiRecommendationDto,
  ): Promise<AiRecommendationDocument> {
    try {
      const recommendation = new this.aiRecommendationModel({
        ...createDto,
        userId: new Types.ObjectId(createDto.userId),
      });
      return await recommendation.save();
    } catch (error) {
      handleMongoError(error);
    }
  }

  async findAll(
    query: Partial<PaginationDto> = {},
  ): Promise<PaginatedResponse<AiRecommendation>> {
    const { page = 1, limit = 10, sort = 'createdAt', order = 'desc' } = query;
    const skip = (page - 1) * limit;
    const sortQuery: Record<string, 1 | -1> = {
      [sort]: order === 'asc' ? 1 : -1,
    };

    const [recommendations, total] = await Promise.all([
      this.aiRecommendationModel
        .find()
        .populate('userId', 'fullName email')
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.aiRecommendationModel.countDocuments(),
    ]);

    return {
      items: recommendations.map((rec) => rec.toObject()),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async findById(
    id: string,
    requester?: Requester,
  ): Promise<AiRecommendationDocument> {
    try {
      const recommendation = await this.aiRecommendationModel
        .findById(id)
        .populate('userId', 'fullName email')
        .exec();
      if (!recommendation) {
        throw new NotFoundException(
          `AI recommendation with ID ${id} not found`,
        );
      }
      if (requester) {
        assertOwnerOrAdmin(recommendation.userId, requester, 'recommendation');
      }
      return recommendation;
    } catch (error) {
      handleMongoError(error);
    }
  }

  async findByUserId(userId: string): Promise<AiRecommendationDocument[]> {
    return this.aiRecommendationModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByCategory(
    category: RecommendationCategory,
  ): Promise<AiRecommendationDocument[]> {
    return this.aiRecommendationModel
      .find({ category })
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByUserAndCategory(
    userId: string,
    category: RecommendationCategory,
  ): Promise<AiRecommendationDocument[]> {
    return this.aiRecommendationModel
      .find({
        userId: new Types.ObjectId(userId),
        category,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    id: string,
    updateDto: UpdateAiRecommendationDto,
  ): Promise<AiRecommendationDocument> {
    try {
      const recommendation = await this.aiRecommendationModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .populate('userId', 'fullName email')
        .exec();
      if (!recommendation) {
        throw new NotFoundException(
          `AI recommendation with ID ${id} not found`,
        );
      }
      return recommendation;
    } catch (error) {
      handleMongoError(error);
    }
  }

  async remove(id: string): Promise<AiRecommendationDocument> {
    try {
      const recommendation = await this.aiRecommendationModel
        .findByIdAndDelete(id)
        .exec();
      if (!recommendation) {
        throw new NotFoundException(
          `AI recommendation with ID ${id} not found`,
        );
      }
      return recommendation;
    } catch (error) {
      handleMongoError(error);
    }
  }
}
