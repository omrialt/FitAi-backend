import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  ValidationPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProgressStatsService } from './progress-stats.service';
import type { UpdateProgressStatsDto } from '../../interfaces/progress-stats.interfaces';
import type { ProgressStats } from './progress-stats.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('progress')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProgressStatsController {
  constructor(private readonly progressStatsService: ProgressStatsService) {}

  @Get(':userId')
  @Roles('user', 'trainer', 'admin')
  async getProgressStats(
    @Param('userId') userId: string,
  ): Promise<ProgressStats> {
    return this.progressStatsService.getProgressStatsByUserId(userId);
  }

  @Post(':userId/recalculate')
  @Roles('user', 'trainer', 'admin')
  async recalculateProgressStats(
    @Param('userId') userId: string,
  ): Promise<ProgressStats> {
    return this.progressStatsService.regenerateProgressStats(userId);
  }

  @Patch(':userId')
  @Roles('user', 'trainer', 'admin')
  async updateProgressStats(
    @Param('userId') userId: string,
    @Body(ValidationPipe) updateData: UpdateProgressStatsDto,
  ): Promise<ProgressStats> {
    return this.progressStatsService.updateProgressStats(userId, updateData);
  }

  @Post(':userId/workout-completed')
  @Roles('user', 'trainer', 'admin')
  async incrementWorkoutCount(
    @Param('userId') userId: string,
    @Body() body: { increment?: number },
  ): Promise<ProgressStats> {
    const increment = body.increment || 1;
    return this.progressStatsService.updateWorkoutCount(userId, increment);
  }

  @Post('bulk/recalculate')
  @Roles('admin')
  async bulkRecalculateStats(
    @Body() body: { userIds?: string[] },
  ): Promise<ProgressStats[]> {
    return this.progressStatsService.bulkRegenerateStats(body.userIds);
  }
}