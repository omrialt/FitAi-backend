import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PhysicalData, PhysicalDataDocument } from './physical-data.schema';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResponse } from '../../interfaces/pagination.interfaces';
import { CreatePhysicalDataDto } from '../../interfaces/physical-data.interfaces';
import { handleMongoError } from '../../utils/mongo.helpers';
import { assertOwnerOrAdmin, type Requester } from '../../utils/ownership';

@Injectable()
export class PhysicalDataService {
  constructor(
    @InjectModel('PhysicalData')
    private physicalDataModel: Model<PhysicalDataDocument>,
  ) {}

  async create(
    createDto: CreatePhysicalDataDto & { userId: string },
  ): Promise<PhysicalDataDocument> {
    try {
      const physicalData = new this.physicalDataModel({
        ...createDto,
        userId: new Types.ObjectId(createDto.userId),
        ...(createDto.dateRecorded
          ? { dateRecorded: new Date(createDto.dateRecorded) }
          : {}),
      });
      return await physicalData.save();
    } catch (error) {
      handleMongoError(error);
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

  async findById(
    id: string,
    requester?: Requester,
  ): Promise<PhysicalDataDocument> {
    try {
      const physicalData = await this.physicalDataModel
        .findById(id)
        .populate('userId', 'fullName email')
        .exec();
      if (!physicalData) {
        throw new NotFoundException(`Physical data with ID ${id} not found`);
      }
      if (requester) {
        assertOwnerOrAdmin(physicalData.userId, requester, 'measurement');
      }
      return physicalData;
    } catch (error) {
      handleMongoError(error);
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
    data: Partial<PhysicalData>,
    requester?: Requester,
  ): Promise<PhysicalDataDocument> {
    try {
      // Ownership is checked before the write, not after, so a denied caller
      // never mutates the record.
      if (requester) {
        await this.assertCanModify(id, requester);
      }

      const physicalData = await this.physicalDataModel
        .findByIdAndUpdate(id, data, {
          new: true,
          runValidators: true,
        })
        .populate('userId', 'fullName email')
        .exec();
      if (!physicalData) {
        throw new NotFoundException(`Physical data with ID ${id} not found`);
      }
      return physicalData;
    } catch (error) {
      return handleMongoError(error);
    }
  }

  async remove(
    id: string,
    requester?: Requester,
  ): Promise<PhysicalDataDocument> {
    try {
      if (requester) {
        await this.assertCanModify(id, requester);
      }

      const physicalData = await this.physicalDataModel
        .findByIdAndDelete(id)
        .exec();
      if (!physicalData) {
        throw new NotFoundException(`Physical data with ID ${id} not found`);
      }
      return physicalData;
    } catch (error) {
      handleMongoError(error);
    }
  }

  /** Load just the owner of a record and assert the requester matches it. */
  private async assertCanModify(
    id: string,
    requester: Requester,
  ): Promise<void> {
    const existing = await this.physicalDataModel
      .findById(id)
      .select('userId')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException(`Physical data with ID ${id} not found`);
    }
    assertOwnerOrAdmin(existing.userId, requester, 'measurement');
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
