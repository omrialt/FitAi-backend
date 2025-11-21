import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ExercisePerformance,
  ExercisePerformanceDocument,
} from './exercise-performance.schema';

export interface CreateExercisePerformanceDto {
  userId: string;
  exerciseId: string;
  trainingPlanId?: string;
  trainingDayName: string;
  setIndex: number;
  weight: number;
  reps: number;
  timestamp: Date;
  notes?: string;
}

export interface UpdateExercisePerformanceDto {
  trainingPlanId?: string;
  trainingDayName?: string;
  setIndex?: number;
  weight?: number;
  reps?: number;
  timestamp?: Date;
  notes?: string;
}

@Injectable()
export class ExercisePerformanceService {
  constructor(
    @InjectModel('ExercisePerformance')
    private exercisePerformanceModel: Model<ExercisePerformanceDocument>,
  ) {}

  async create(
    createData: CreateExercisePerformanceDto,
  ): Promise<ExercisePerformance> {
    const createdPerformance = new this.exercisePerformanceModel(createData);
    return createdPerformance.save();
  }

  async findAll(): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceModel
      .find()
      .populate('userId')
      .populate('trainingPlanId')
      .sort({ timestamp: -1 })
      .exec();
  }

  async findById(id: string): Promise<ExercisePerformance> {
    const performance = await this.exercisePerformanceModel
      .findById(id)
      .populate('userId')
      .populate('trainingPlanId')
      .exec();

    if (!performance) {
      throw new NotFoundException(`Exercise performance with ID ${id} not found`);
    }

    return performance;
  }

  async findByUserId(userId: string): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceModel
      .find({ userId })
      .populate('userId')
      .populate('trainingPlanId')
      .sort({ timestamp: -1 })
      .exec();
  }

  async findByExerciseId(exerciseId: string): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceModel
      .find({ exerciseId })
      .populate('userId')
      .populate('trainingPlanId')
      .sort({ timestamp: -1 })
      .exec();
  }

  async findByUserAndExercise(
    userId: string,
    exerciseId: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceModel
      .find({ userId, exerciseId })
      .populate('userId')
      .populate('trainingPlanId')
      .sort({ timestamp: -1 })
      .exec();
  }

  async findByTrainingPlan(
    trainingPlanId: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceModel
      .find({ trainingPlanId })
      .populate('userId')
      .populate('trainingPlanId')
      .sort({ timestamp: -1 })
      .exec();
  }

  async update(
    id: string,
    updateData: UpdateExercisePerformanceDto,
  ): Promise<ExercisePerformance> {
    const updatedPerformance = await this.exercisePerformanceModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .populate('userId')
      .populate('trainingPlanId')
      .exec();

    if (!updatedPerformance) {
      throw new NotFoundException(`Exercise performance with ID ${id} not found`);
    }

    return updatedPerformance;
  }

  async delete(id: string): Promise<void> {
    const result = await this.exercisePerformanceModel.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Exercise performance with ID ${id} not found`);
    }
  }

  async getLatestPerformanceForExercise(
    userId: string,
    exerciseId: string,
  ): Promise<ExercisePerformance | null> {
    return this.exercisePerformanceModel
      .findOne({ userId, exerciseId })
      .populate('userId')
      .populate('trainingPlanId')
      .sort({ timestamp: -1 })
      .exec();
  }

  async getPerformanceHistory(
    userId: string,
    exerciseId: string,
    limit: number = 10,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceModel
      .find({ userId, exerciseId })
      .populate('userId')
      .populate('trainingPlanId')
      .sort({ timestamp: -1 })
      .limit(limit)
      .exec();
  }

  async getPerformanceByDateRange(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceModel
      .find({
        userId,
        timestamp: { $gte: startDate, $lte: endDate },
      })
      .populate('userId')
      .populate('trainingPlanId')
      .sort({ timestamp: -1 })
      .exec();
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.exercisePerformanceModel.deleteMany({ userId }).exec();
  }
}