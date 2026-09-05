import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { MealLogService } from './meal-log.service';
// Value imports: `import type` erases the class and the global ValidationPipe
// then never sees a DTO to validate.
import {
  CreateMealLogDto,
  DayQueryDto,
  RangeQueryDto,
} from '../../interfaces/meal-log.interfaces';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserOwnershipGuard } from '../../common/guards/ownership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnsUserParam } from '../../common/decorators/owns-user-param.decorator';

/**
 * A food diary is closer to the workout log than to the photo timeline: a
 * connected trainer who can already see what their client lifted has a
 * legitimate reason to see what they ate, and it is the same relationship
 * governing both. So the client-scoped read uses `@OwnsUserParam`, exactly like
 * `/workout-sessions/user/:userId/stats`, rather than the per-row opt-in the
 * body photos needed.
 *
 * Writing and deleting stay strictly first-person — there is no `:userId` on
 * either, so a trainer cannot log or remove a meal on someone's behalf even in
 * principle.
 */
@Controller('meal-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard, UserOwnershipGuard)
export class MealLogController {
  constructor(private readonly mealLogs: MealLogService) {}

  /**
   * One day: what was eaten, the target, and what is left.
   *
   * `day` comes from the client. It falls back to the server's date only when
   * omitted, which is a last resort and not the intended path — the server runs
   * in UTC and does not know what day it is where the user is standing.
   */
  @Get('today')
  @Roles('user', 'trainer', 'admin')
  getToday(@Query() query: DayQueryDto, @Request() req: AuthRequest) {
    const day = query.day ?? new Date().toISOString().slice(0, 10);
    return this.mealLogs.getDay(req.user.id, day);
  }

  /** The same view for a connected client, for the trainer's screen. */
  @Get('user/:userId/day')
  @Roles('trainer', 'admin')
  @OwnsUserParam()
  getForClient(
    @Param('userId') userId: string,
    @Query() query: DayQueryDto,
  ) {
    const day = query.day ?? new Date().toISOString().slice(0, 10);
    return this.mealLogs.getDay(userId, day);
  }

  @Get()
  @Roles('user', 'trainer', 'admin')
  list(@Query() query: RangeQueryDto, @Request() req: AuthRequest) {
    return this.mealLogs.listRange(req.user.id, query.from, query.to);
  }

  @Post()
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateMealLogDto, @Request() req: AuthRequest) {
    return this.mealLogs.create(req.user.id, {
      localDay: body.localDay,
      mealType: body.mealType,
      source: body.source,
      label: body.label,
      foods: body.foods,
      notes: body.notes,
      loggedAt: body.loggedAt ? new Date(body.loggedAt) : undefined,
    });
  }

  @Delete(':id')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.mealLogs.remove(id, req.user.id);
  }
}
