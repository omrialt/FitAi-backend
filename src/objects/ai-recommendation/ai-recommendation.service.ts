import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AiRecommendation,
  AiRecommendationDocument,
  RecommendationCategory,
} from './ai-recommendation.schema';
import {
  PaginationDto,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import {
  CreateAiRecommendationDto,
  UpdateAiRecommendationDto,
} from '../interfaces/ai-recommendation.interfaces';

@Injectable()
export class AiRecommendationService {
  constructor(
    @InjectModel('AiRecommendation')
    private aiRecommendationModel: Model<AiRecommendationDocument>,
  ) {}

  private handleMongoError(error: unknown): never {
    if (error instanceof Error) {
      type MongoErrorLike = Error & { name?: string; code?: number | string };
      const mongoError = error as MongoErrorLike;
      if (mongoError.name === 'CastError') {
        throw new BadRequestException('Invalid ID format');
      }
      if (mongoError.code === 11000) {
        throw new BadRequestException(
          'AI recommendation with this data already exists',
        );
      }
    }
    throw error;
  }

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
      this.handleMongoError(error);
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

  async findById(id: string): Promise<AiRecommendationDocument> {
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
      return recommendation;
    } catch (error) {
      this.handleMongoError(error);
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
      this.handleMongoError(error);
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
      this.handleMongoError(error);
    }
  }
}
