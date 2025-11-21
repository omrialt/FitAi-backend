import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CurrentStatus,
  CurrentStatusDocument,
  Phase,
} from './current-status.schema';

export interface UpdateCurrentStatusDto {
  activeTrainingPlanId?: string | null;
  activeMenuId?: string | null;
  lastWorkoutDate?: Date;
  nextWorkoutDate?: Date;
  phase?: Phase;
}

export interface SetActiveTrainingPlanDto {
  activeTrainingPlanId: string | null;
}

export interface SetActiveMenuDto {
  activeMenuId: string | null;
}

export interface SetPhaseDto {
  phase: Phase;
}

@Injectable()
export class CurrentStatusService {
  constructor(
    @InjectModel('CurrentStatus')
    private currentStatusModel: Model<CurrentStatusDocument>,
  ) {}

  async getCurrentStatusByUserId(userId: string): Promise<CurrentStatus> {
    const currentStatus = await this.currentStatusModel
      .findOne({ userId })
      .populate('activeTrainingPlanId')
      .populate('activeMenuId')
      .exec();

    if (!currentStatus) {
      // Create default status if not exists
      return this.createDefaultStatus(userId);
    }

    return currentStatus;
  }

  async updateCurrentStatus(
    userId: string,
    updateData: UpdateCurrentStatusDto,
  ): Promise<CurrentStatus> {
    const updatedStatus = await this.currentStatusModel
      .findOneAndUpdate({ userId }, updateData, {
        new: true,
        upsert: true,
      })
      .populate('activeTrainingPlanId')
      .populate('activeMenuId')
      .exec();

    if (!updatedStatus) {
      throw new NotFoundException(
        `Current status for user ${userId} not found`,
      );
    }

    return updatedStatus;
  }

  async setActiveTrainingPlan(
    userId: string,
    data: SetActiveTrainingPlanDto,
  ): Promise<CurrentStatus> {
    return this.updateCurrentStatus(userId, {
      activeTrainingPlanId: data.activeTrainingPlanId,
    });
  }

  async setActiveMenu(
    userId: string,
    data: SetActiveMenuDto,
  ): Promise<CurrentStatus> {
    return this.updateCurrentStatus(userId, {
      activeMenuId: data.activeMenuId,
    });
  }

  async setPhase(userId: string, data: SetPhaseDto): Promise<CurrentStatus> {
    return this.updateCurrentStatus(userId, {
      phase: data.phase,
    });
  }

  async updateWorkoutDates(
    userId: string,
    lastWorkoutDate?: Date,
    nextWorkoutDate?: Date,
  ): Promise<CurrentStatus> {
    return this.updateCurrentStatus(userId, {
      lastWorkoutDate,
      nextWorkoutDate,
    });
  }

  async markWorkoutCompleted(userId: string): Promise<CurrentStatus> {
    return this.updateCurrentStatus(userId, {
      lastWorkoutDate: new Date(),
    });
  }

  async getAllStatuses(): Promise<CurrentStatus[]> {
    return this.currentStatusModel
      .find()
      .populate('activeTrainingPlanId')
      .populate('activeMenuId')
      .exec();
  }

  async deleteCurrentStatus(userId: string): Promise<void> {
    const result = await this.currentStatusModel.deleteOne({ userId }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(
        `Current status for user ${userId} not found`,
      );
    }
  }

  private async createDefaultStatus(userId: string): Promise<CurrentStatus> {
    const defaultStatus = new this.currentStatusModel({
      userId,
      activeTrainingPlanId: null,
      activeMenuId: null,
      lastWorkoutDate: null,
      nextWorkoutDate: null,
      phase: 'maintain',
    });

    return defaultStatus.save();
  }

  async findByActiveTrainingPlan(
    trainingPlanId: string,
  ): Promise<CurrentStatus[]> {
    return this.currentStatusModel
      .find({ activeTrainingPlanId: trainingPlanId })
      .populate('activeTrainingPlanId')
      .populate('activeMenuId')
      .exec();
  }

  async findByActiveMenu(menuId: string): Promise<CurrentStatus[]> {
    return this.currentStatusModel
      .find({ activeMenuId: menuId })
      .populate('activeTrainingPlanId')
      .populate('activeMenuId')
      .exec();
  }

  async findByPhase(phase: Phase): Promise<CurrentStatus[]> {
    return this.currentStatusModel
      .find({ phase })
      .populate('activeTrainingPlanId')
      .populate('activeMenuId')
      .exec();
  }
}