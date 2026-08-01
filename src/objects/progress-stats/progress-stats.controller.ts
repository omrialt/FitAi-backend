import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProgressStatsService } from './progress-stats.service';
// Value imports: a type-only import erases the class and the global
// ValidationPipe then never sees a DTO to validate.
import {
  IncrementWorkoutCountDto,
  UpdateProgressStatsDto,
} from '../../interfaces/progress-stats.interfaces';
import type { ProgressStats } from './progress-stats.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserOwnershipGuard } from '../../common/guards/ownership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnsUserParam } from '../../common/decorators/owns-user-param.decorator';

@Controller('progress')
@UseGuards(AuthGuard('jwt'), RolesGuard, UserOwnershipGuard)
export class ProgressStatsController {
  constructor(private readonly progressStatsService: ProgressStatsService) {}

  @Get(':userId')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async getProgressStats(
    @Param('userId') userId: string,
  ): Promise<ProgressStats> {
    return this.progressStatsService.getProgressStatsByUserId(userId);
  }

  // Must stay above ':userId/recalculate'. Express matches in registration
  // order, so the literal path has to be declared first — otherwise
  // /progress/bulk/recalculate binds userId='bulk' and never reaches here,
  // silently running a single-user recalculation instead of the bulk one.
  @Post('bulk/recalculate')
  @Roles('admin')
  async bulkRecalculateStats(
    @Body() body: { userIds?: string[] },
  ): Promise<ProgressStats[]> {
    return this.progressStatsService.bulkRegenerateStats(body.userIds);
  }

  @Post(':userId/recalculate')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async recalculateProgressStats(
    @Param('userId') userId: string,
  ): Promise<ProgressStats> {
    return this.progressStatsService.regenerateProgressStats(userId);
  }

  @Patch(':userId')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async updateProgressStats(
    @Param('userId') userId: string,
    @Body() updateData: UpdateProgressStatsDto,
  ): Promise<ProgressStats> {
    return this.progressStatsService.updateProgressStats(userId, updateData);
  }

  @Post(':userId/workout-completed')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  async incrementWorkoutCount(
    @Param('userId') userId: string,
    @Body() body: IncrementWorkoutCountDto,
  ): Promise<ProgressStats> {
    const increment = body.increment ?? 1;
    return this.progressStatsService.updateWorkoutCount(userId, increment);
  }
}
