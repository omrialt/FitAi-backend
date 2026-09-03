import {
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

import { AiReviewService } from './ai-review.service';
import { AnthropicService } from '../../common/anthropic/anthropic.service';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Manual trigger for the weekly review.
 *
 * Callers can only ever ask for their own review — there is no `:userId`
 * parameter to point somewhere else, which is a stronger guarantee than a
 * guard because there is nothing to guard.
 */
@Controller('ai-review')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AiReviewController {
  constructor(
    private readonly reviews: AiReviewService,
    private readonly anthropic: AnthropicService,
  ) {}

  /**
   * Lets the client hide the button rather than offer one that 503s — and
   * lets a human tell "a key is configured" apart from "a request has ever
   * come back".
   *
   * `enabled` was the whole answer here until now, and it is the weaker half.
   * Every earlier round of this project shipped at least one thing that was
   * enabled and inert: the rate limiter with no Redis, the alerting with no
   * recipient, this review with no key. `lastOkAt` is the field that cannot
   * be satisfied by configuration alone — it only becomes non-null when the
   * API actually answered.
   */
  @Get('status')
  @Roles('user', 'trainer', 'admin')
  status() {
    return this.anthropic.status;
  }

  @Post('me')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.CREATED)
  async reviewMe(@Request() req: AuthRequest) {
    if (!this.reviews.enabled) {
      throw new ServiceUnavailableException(
        'AI review is not configured on this server',
      );
    }

    const written = await this.reviews.reviewUser(req.user.id);
    if (!written) {
      // Not an error: there is simply not enough training logged yet to write
      // something true, and saying so beats returning an empty review.
      throw new UnprocessableEntityException(
        'Not enough logged training in the last four weeks for a review',
      );
    }

    return { created: true };
  }
}
