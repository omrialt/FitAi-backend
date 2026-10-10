import {
  Body,
  Controller,
  Get,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TrainerDashboardService } from './trainer-dashboard.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
// Value import: a type-only import erases the class and the ValidationPipe
// then hands the handler `undefined`.
import { UpdateTrainerAlertSettingsDto } from '../../interfaces/trainer-dashboard.interfaces';

/**
 * No route takes an id, on purpose: the roster is derived from the caller's
 * own accepted connections and the settings are the caller's own, so there is
 * no id in the URL for anyone to substitute.
 */
@Controller('trainer-dashboard')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TrainerDashboardController {
  constructor(private readonly service: TrainerDashboardService) {}

  @Get()
  @Roles('trainer', 'admin')
  async overview(@Request() req: AuthRequest) {
    return this.service.getOverview(req.user.id);
  }

  /** The alert thresholds this trainer's roster is judged by. */
  @Get('settings')
  @Roles('trainer', 'admin')
  async settings(@Request() req: AuthRequest) {
    return this.service.getSettings(req.user.id);
  }

  @Put('settings')
  @Roles('trainer', 'admin')
  async saveSettings(
    @Body() body: UpdateTrainerAlertSettingsDto,
    @Request() req: AuthRequest,
  ) {
    return this.service.saveSettings(req.user.id, body);
  }
}
