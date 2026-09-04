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
import { WorkoutSessionService } from './workout-session.service';
import { WorkoutStatsService } from './workout-stats.service';
import { ProgressionService } from './progression.service';
// Value imports on purpose: `import type` erases the class, the emitted
// parameter metadata becomes `Function`, and the global ValidationPipe then
// passes `undefined` to the handler instead of the body.
import {
  CreateWorkoutSessionDto,
  ExerciseHistoryQueryDto,
  ListWorkoutSessionsDto,
  OverloadQueryDto,
  WorkoutStatsQueryDto,
} from '../../interfaces/workout-session.interfaces';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserOwnershipGuard } from '../../common/guards/ownership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnsUserParam } from '../../common/decorators/owns-user-param.decorator';

@Controller('workout-sessions')
@UseGuards(AuthGuard('jwt'), RolesGuard, UserOwnershipGuard)
export class WorkoutSessionController {
  constructor(
    private readonly workoutSessionService: WorkoutSessionService,
    private readonly workoutStatsService: WorkoutStatsService,
    private readonly progressionService: ProgressionService,
  ) {}

  /**
   * Log a completed workout. The session is always filed against the caller —
   * there is no body field that can redirect it to another user.
   */
  @Post()
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateWorkoutSessionDto, @Request() req: AuthRequest) {
    return this.workoutSessionService.create(req.user.id, dto);
  }

  /**
   * A user's training log. Carries `@OwnsUserParam`, so a trainer with an
   * accepted connection can read their client's log and nobody else can.
   */
  @Get('user/:userId')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  findByUserId(
    @Param('userId') userId: string,
    @Query() query: ListWorkoutSessionsDto,
  ) {
    return this.workoutSessionService.findByUserId(userId, query);
  }

  /**
   * Personal bests, streak and adherence. Declared before `:id` is irrelevant
   * here — the paths differ in segment count — but it carries the same
   * `@OwnsUserParam`, so a connected trainer sees their client's numbers.
   */
  @Get('user/:userId/stats')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  getStats(
    @Param('userId') userId: string,
    @Query() query: WorkoutStatsQueryDto,
  ) {
    return this.workoutStatsService.getStats(userId, query.days ?? 30);
  }

  /**
   * One exercise's strength curve. Same `@OwnsUserParam` as `/stats`, so a
   * connected trainer can see whether their client's bench has moved.
   */
  @Get('user/:userId/exercise-history')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  getExerciseHistory(
    @Param('userId') userId: string,
    @Query() query: ExerciseHistoryQueryDto,
  ) {
    return this.workoutStatsService.getExerciseHistory(
      userId,
      query.name,
      query.days,
    );
  }

  /**
   * Whether the recent block looks like accumulating fatigue. Same
   * `@OwnsUserParam` as the other user-scoped reads, so a connected trainer
   * can see it for their client.
   */
  @Get('user/:userId/fatigue')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  getFatigue(@Param('userId') userId: string) {
    return this.workoutStatsService.getFatigueSignal(userId);
  }

  /**
   * What to do next session, per exercise. Same `@OwnsUserParam` as the other
   * user-scoped reads, so a connected trainer sees their client's next step.
   *
   * No AI: double progression over the real log. The disabled button on the
   * trainings page has been promising this since the first revision of the
   * gap analysis, filed under the AI tier the whole time.
   */
  @Get('user/:userId/overload')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  getOverload(
    @Param('userId') userId: string,
    @Query() query: OverloadQueryDto,
  ) {
    return this.progressionService.getOverloadPlan(
      userId,
      query.exercise,
      query.limit,
    );
  }

  /**
   * What backing off would look like in kilos and sets.
   *
   * Always 200, never 404: "you do not need a deload" is the answer most of
   * the time and is not a missing resource. The client reads `recommended`.
   */
  @Get('user/:userId/deload')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  getDeload(@Param('userId') userId: string) {
    return this.progressionService.getDeloadPrescription(userId);
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.workoutSessionService.findById(id, req.user);
  }

  @Delete(':id')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.workoutSessionService.remove(id, req.user);
  }
}
