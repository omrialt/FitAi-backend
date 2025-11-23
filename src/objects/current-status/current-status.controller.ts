import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentStatusService } from './current-status.service';
import type {
  UpdateCurrentStatusDto,
  SetActiveTrainingPlanDto,
  SetActiveMenuDto,
  SetPhaseDto,
} from '../interfaces/current-status.interfaces';
import type { CurrentStatus } from './current-status.schema';

@Controller('status')
export class CurrentStatusController {
  constructor(private readonly currentStatusService: CurrentStatusService) {}

  @Get(':userId')
  async getCurrentStatus(
    @Param('userId') userId: string,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.getCurrentStatusByUserId(userId);
  }

  @Patch(':userId')
  async updateCurrentStatus(
    @Param('userId') userId: string,
    @Body(ValidationPipe) updateData: UpdateCurrentStatusDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.updateCurrentStatus(userId, updateData);
  }

  @Patch(':userId/plan')
  async setActiveTrainingPlan(
    @Param('userId') userId: string,
    @Body(ValidationPipe) data: SetActiveTrainingPlanDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.setActiveTrainingPlan(userId, data);
  }

  @Patch(':userId/menu')
  async setActiveMenu(
    @Param('userId') userId: string,
    @Body(ValidationPipe) data: SetActiveMenuDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.setActiveMenu(userId, data);
  }

  @Patch(':userId/phase')
  async setPhase(
    @Param('userId') userId: string,
    @Body(ValidationPipe) data: SetPhaseDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.setPhase(userId, data);
  }

  @Patch(':userId/workout-completed')
  async markWorkoutCompleted(
    @Param('userId') userId: string,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.markWorkoutCompleted(userId);
  }
}