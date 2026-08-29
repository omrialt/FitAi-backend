import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AiReviewService } from './ai-review.service';

/**
 * Runs the weekly review for everyone who has trained recently.
 *
 * Monday morning on purpose: a review that lands after the week is planned is
 * a report, and one that lands before it is a plan.
 *
 * Users are processed one at a time rather than with `Promise.all`. This is a
 * paid API and a background job — nothing is waiting on it, and a burst of
 * concurrent requests buys nothing but a rate limit.
 */
@Injectable()
export class AiReviewScheduler {
  private readonly logger = new Logger(AiReviewScheduler.name);

  constructor(
    private readonly reviews: AiReviewService,
    @InjectModel('WorkoutSession')
    private readonly sessionModel: Model<unknown>,
    @InjectModel('User')
    private readonly userModel: Model<unknown>,
  ) {}

  @Cron(CronExpression.EVERY_WEEK, { name: 'weekly-ai-review' })
  async run(): Promise<void> {
    if (!this.reviews.enabled) return;

    const since = new Date(Date.now() - 28 * 24 * 3600 * 1000);

    // Only users who actually trained in the window: everyone else would get
    // a review about nothing, and would be charged for elsewhere.
    const userIds = (await this.sessionModel
      .distinct('userId', { performedAt: { $gte: since } })
      .exec()) as { toString(): string }[];

    let written = 0;

    for (const userId of userIds) {
      const id = userId.toString();
      try {
        const user = await this.userModel
          .findById(id)
          .select('email isActive')
          .lean<{ email?: string; isActive?: boolean }>()
          .exec();

        if (!user || user.isActive === false) continue;

        if (await this.reviews.reviewUser(id, user.email)) written += 1;
      } catch (error) {
        // One user's failure must not end the run for everyone after them.
        this.logger.error(
          `Weekly review failed for ${id}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Weekly AI review: ${written} written across ${userIds.length} active users.`,
    );
  }
}
