import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { CoachChatService } from './coach-chat.service';
import { PlanGeneratorService } from './plan-generator.service';
import { TrainingPlanService } from '../training-plan/training-plan.service';
// Value imports: `import type` erases the class and the global ValidationPipe
// then never sees a DTO to validate.
import { CoachChatDto, GeneratePlanDto } from '../../interfaces/ai-coach.interfaces';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Both routes act on the caller and only the caller. There is no `:userId`
 * anywhere in this controller, which is a stronger guarantee than a guard
 * because there is nothing to guard: a request cannot name someone else's
 * training even in principle.
 */
@Controller('ai-coach')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AiCoachController {
  constructor(
    private readonly chat: CoachChatService,
    private readonly generator: PlanGeneratorService,
    private readonly plans: TrainingPlanService,
  ) {}

  /** Lets the client hide both features rather than offer buttons that 503. */
  @Get('status')
  @Roles('user', 'trainer', 'admin')
  status() {
    return { chat: this.chat.enabled, planGeneration: this.generator.enabled };
  }

  @Post('chat')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.OK)
  async ask(@Body() body: CoachChatDto, @Request() req: AuthRequest) {
    if (!this.chat.enabled) {
      throw new ServiceUnavailableException(
        'The coach is not configured on this server',
      );
    }

    const reply = await this.chat.ask(
      req.user.id,
      body.question,
      body.history ?? [],
    );

    if (!reply.answer) {
      // A refusal, a truncated answer and an unreachable API all land here.
      // The reason is in the server's `lastError`, not in the user's face.
      throw new UnprocessableEntityException(
        'The coach could not answer that right now',
      );
    }

    return reply.answer;
  }

  /**
   * Generates a plan and saves it, in one call.
   *
   * Deliberately not a preview-then-confirm pair. A generated plan is an
   * ordinary editable plan from the moment it exists, the user is looking at
   * the plan editor either way, and a two-step flow would mean either holding
   * the result in memory between requests or paying for the generation twice.
   * Deleting a plan they do not want is one click.
   */
  @Post('plan')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.CREATED)
  async generatePlan(
    @Body() body: GeneratePlanDto,
    @Request() req: AuthRequest,
  ) {
    if (!this.generator.enabled) {
      throw new ServiceUnavailableException(
        'Plan generation is not configured on this server',
      );
    }

    const { plan, droppedSlugs } = await this.generator.generate({
      userId: req.user.id,
      goal: body.goal,
      daysPerWeek: body.daysPerWeek,
      equipment: body.equipment,
      avoid: body.avoid,
      experience: body.experience,
      weekdays: body.weekdays,
      language: body.language,
    });

    if (!plan) {
      throw new UnprocessableEntityException(
        'Could not generate a plan from those answers',
      );
    }

    const saved = await this.plans.create(plan);

    // Surfaced rather than swallowed: a non-empty list means the model named
    // an exercise the app does not have and it was dropped, so the plan the
    // user is about to see is thinner than the one that was written.
    return { plan: saved, droppedSlugs };
  }
}
