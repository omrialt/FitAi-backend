import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentStatusService } from './current-status.service';
// Value imports: with `import type` these erased to `Object` and the
// `@Body(ValidationPipe)` on every handler below validated nothing.
import {
  UpdateCurrentStatusDto,
  SetActiveTrainingPlanDto,
  SetActiveMenuDto,
  SetPhaseDto,
} from '../../interfaces/current-status.interfaces';
import type { CurrentStatus } from './current-status.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserOwnershipGuard } from '../../common/guards/ownership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnsUserParam } from '../../common/decorators/owns-user-param.decorator';

@Controller('status')
@UseGuards(AuthGuard('jwt'), RolesGuard, UserOwnershipGuard)
export class CurrentStatusController {
  constructor(private readonly currentStatusService: CurrentStatusService) {}

  @Get(':userId')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async getCurrentStatus(
    @Param('userId') userId: string,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.getCurrentStatusByUserId(userId);
  }

  @Patch(':userId')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async updateCurrentStatus(
    @Param('userId') userId: string,
    @Body() updateData: UpdateCurrentStatusDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.updateCurrentStatus(userId, updateData);
  }

  @Patch(':userId/plan')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async setActiveTrainingPlan(
    @Param('userId') userId: string,
    @Body() data: SetActiveTrainingPlanDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.setActiveTrainingPlan(userId, data);
  }

  @Patch(':userId/menu')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async setActiveMenu(
    @Param('userId') userId: string,
    @Body() data: SetActiveMenuDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.setActiveMenu(userId, data);
  }

  @Patch(':userId/phase')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async setPhase(
    @Param('userId') userId: string,
    @Body() data: SetPhaseDto,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.setPhase(userId, data);
  }

  @Patch(':userId/workout-completed')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async markWorkoutCompleted(
    @Param('userId') userId: string,
  ): Promise<CurrentStatus> {
    return this.currentStatusService.markWorkoutCompleted(userId);
  }
}
