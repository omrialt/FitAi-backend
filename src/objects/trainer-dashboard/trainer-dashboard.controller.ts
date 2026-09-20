import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TrainerDashboardService } from './trainer-dashboard.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

/**
 * One route, and it takes no parameters on purpose: the roster is derived from
 * the caller's own accepted connections, so there is no id in the URL for
 * anyone to substitute.
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
}
