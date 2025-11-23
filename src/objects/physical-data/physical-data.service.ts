import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PhysicalData,
  PhysicalDataDocument,
  Measurements,
} from './physical-data.schema';
import {
  PaginationDto,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import {
  CreatePhysicalDataDto,
  UpdatePhysicalDataDto,
} from '../interfaces/physical-data.interfaces';

@Injectable()
export class PhysicalDataService {
  constructor(
    @InjectModel('PhysicalData')
    private physicalDataModel: Model<PhysicalDataDocument>,
  ) {}

  private handleMongoError(error: unknown): never {
    if (error instanceof Error) {
      type MongoError = Error & { code?: number; name?: string };
      const mongoError = error as MongoError;
      if (mongoError.name === 'CastError') {
        throw new BadRequestException('Invalid ID format');
      }
      if (mongoError.code === 11000) {
        throw new BadRequestException(
          'Physical data with this information already exists',
        );
      }
    }
    throw error;
  }

  async create(
    createDto: CreatePhysicalDataDto,
  ): Promise<PhysicalDataDocument> {
    try {
      const physicalData = new this.physicalDataModel({
        ...createDto,
        userId: new Types.ObjectId(createDto.userId),
      });
      return await physicalData.save();
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async findAll(
    query: Partial<PaginationDto> = {},
  ): Promise<PaginatedResponse<PhysicalData>> {
    const {
      page = 1,
      limit = 10,
      sort = 'dateRecorded',
      order = 'desc',
    } = query;
    const skip = (page - 1) * limit;
    const sortQuery: Record<string, 1 | -1> = {
      [sort]: order === 'asc' ? 1 : -1,
    };

    const [physicalData, total] = await Promise.all([
      this.physicalDataModel
        .find()
        .populate('userId', 'fullName email')
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.physicalDataModel.countDocuments(),
    ]);

    return {
      items: physicalData.map((data) => data.toObject()),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async findById(id: string): Promise<PhysicalDataDocument> {
    try {
      const physicalData = await this.physicalDataModel
        .findById(id)
        .populate('userId', 'fullName email')
        .exec();
      if (!physicalData) {
        throw new NotFoundException(`Physical data with ID ${id} not found`);
      }
      return physicalData;
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async findByUserId(userId: string): Promise<PhysicalDataDocument[]> {
    return this.physicalDataModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ dateRecorded: -1 })
      .exec();
  }

  async findLatestByUserId(
    userId: string,
  ): Promise<PhysicalDataDocument | null> {
    return this.physicalDataModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .sort({ dateRecorded: -1 })
      .exec();
  }

  async findByDateRange(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<PhysicalDataDocument[]> {
    return this.physicalDataModel
      .find({
        userId: new Types.ObjectId(userId),
        dateRecorded: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .sort({ dateRecorded: 1 })
      .exec();
  }

  async update(
    id: string,
    updateDto: UpdatePhysicalDataDto,
  ): Promise<PhysicalDataDocument> {
    try {
      const physicalData = await this.physicalDataModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .populate('userId', 'fullName email')
        .exec();
      if (!physicalData) {
        throw new NotFoundException(`Physical data with ID ${id} not found`);
      }
      return physicalData;
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  async remove(id: string): Promise<PhysicalDataDocument> {
    try {
      const physicalData = await this.physicalDataModel
        .findByIdAndDelete(id)
        .exec();
      if (!physicalData) {
        throw new NotFoundException(`Physical data with ID ${id} not found`);
      }
      return physicalData;
    } catch (error) {
      this.handleMongoError(error);
    }
  }

  calculateBMI(heightCm: number, weightKg: number): number {
    const heightM = heightCm / 100;
    return parseFloat((weightKg / (heightM * heightM)).toFixed(2));
  }

  async getWeightProgress(userId: string): Promise<{
    data: Array<{ date: Date; weight: number }>;
    change: number;
  }> {
    const records = await this.findByUserId(userId);

    if (records.length === 0) {
      return { data: [], change: 0 };
    }

    const data = records.map((record) => ({
      date: record.dateRecorded,
      weight: record.weightKg,
    }));

    const change =
      records.length > 1
        ? records[0].weightKg - records[records.length - 1].weightKg
        : 0;

    return { data, change };
  }
}
