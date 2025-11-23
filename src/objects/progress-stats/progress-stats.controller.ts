import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  ValidationPipe,
} from '@nestjs/common';
import { ProgressStatsService } from './progress-stats.service';
import type { UpdateProgressStatsDto } from '../interfaces/progress-stats.interfaces';
import type { ProgressStats } from './progress-stats.schema';

@Controller('progress')
export class ProgressStatsController {
  constructor(private readonly progressStatsService: ProgressStatsService) {}

  @Get(':userId')
  async getProgressStats(
    @Param('userId') userId: string,
  ): Promise<ProgressStats> {
    return this.progressStatsService.getProgressStatsByUserId(userId);
  }

  @Post(':userId/recalculate')
  async recalculateProgressStats(
    @Param('userId') userId: string,
  ): Promise<ProgressStats> {
    return this.progressStatsService.regenerateProgressStats(userId);
  }

  @Patch(':userId')
  async updateProgressStats(
    @Param('userId') userId: string,
    @Body(ValidationPipe) updateData: UpdateProgressStatsDto,
  ): Promise<ProgressStats> {
    return this.progressStatsService.updateProgressStats(userId, updateData);
  }

  @Post(':userId/workout-completed')
  async incrementWorkoutCount(
    @Param('userId') userId: string,
    @Body() body: { increment?: number },
  ): Promise<ProgressStats> {
    const increment = body.increment || 1;
    return this.progressStatsService.updateWorkoutCount(userId, increment);
  }

  @Post('bulk/recalculate')
  async bulkRecalculateStats(
    @Body() body: { userIds?: string[] },
  ): Promise<ProgressStats[]> {
    return this.progressStatsService.bulkRegenerateStats(body.userIds);
  }
}