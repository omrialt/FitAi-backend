import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ValidationPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentStatusService } from './current-status.service';
import type {
  UpdateCurrentStatusDto,
  SetActiveTrainingPlanDto,
  SetActiveMenuDto,
  SetPhaseDto,
} from '../../interfaces/current-status.interfaces';
import type { CurrentStatus } from './current-status.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('status')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CurrentStatusController {
  constructor(private readonly currentStatusService: CurrentStatusService) {}

  @Get(':userId')
  @Roles('user', 'trainer', 'admin')
  async getCurrentStatus(
    @Param('userId') userId: string,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.getCurrentStatusByUserId(userId);
  }

  @Patch(':userId')
  @Roles('user', 'trainer', 'admin')
  async updateCurrentStatus(
    @Param('userId') userId: string,
    @Body(ValidationPipe) updateData: UpdateCurrentStatusDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.updateCurrentStatus(userId, updateData);
  }

  @Patch(':userId/plan')
  @Roles('user', 'trainer', 'admin')
  async setActiveTrainingPlan(
    @Param('userId') userId: string,
    @Body(ValidationPipe) data: SetActiveTrainingPlanDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.setActiveTrainingPlan(userId, data);
  }

  @Patch(':userId/menu')
  @Roles('user', 'trainer', 'admin')
  async setActiveMenu(
    @Param('userId') userId: string,
    @Body(ValidationPipe) data: SetActiveMenuDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.setActiveMenu(userId, data);
  }

  @Patch(':userId/phase')
  @Roles('user', 'trainer', 'admin')
  async setPhase(
    @Param('userId') userId: string,
    @Body(ValidationPipe) data: SetPhaseDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.setPhase(userId, data);
  }

  @Patch(':userId/workout-completed')
  @Roles('user', 'trainer', 'admin')
  async markWorkoutCompleted(
    @Param('userId') userId: string,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.markWorkoutCompleted(userId);
  }
}