import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';

import { WorkoutStatsService } from '../workout-session/workout-stats.service';
import { NodemailerService } from '../../common/nodemailer/nodemailer.service';
import {
  AnthropicService,
  DEFAULT_MODEL,
} from '../../common/anthropic/anthropic.service';

/**
 * The weekly training review — the first thing in FitAi that is actually AI.
 *
 * Five revisions of the gap analysis opened with the same finding: there is no
 * AI in FitAi. Every prerequisite has existed for a while — real performed
 * sets in `WorkoutSession`, derived stats, a scheduler, a mailer, and an
 * `AiRecommendation` collection with `generatedBy` and `tokensUsed` fields
 * that were built for exactly this and never written to by a model.
 *
 * Three decisions shape it:
 *
 *   - **Inert without a key.** No `ANTHROPIC_API_KEY`, no calls, no errors,
 *     no cron. This is the first thing in the project that costs money per
 *     use, so it does not switch itself on because it was deployed;
 *
 *   - **It only sees numbers this app computed.** The prompt carries derived
 *     statistics — volume, adherence, personal bests, the fatigue signal — and
 *     never the user's name, email or id. A training summary does not need to
 *     identify anyone, so it does not;
 *
 *   - **It cannot invent a verdict.** A user without enough history is skipped
 *     before any request is made, rather than asked for a review the data
 *     cannot support.
 */

/**
 * Structured rather than prose, so the app can render it, translate the
 * headings, and store the parts separately — and so a malformed answer fails
 * loudly at parse time instead of reaching the user as a broken email.
 */
const reviewSchema = z.object({
  headline: z.string().min(1),
  wins: z.array(z.string()).max(3),
  watch: z.array(z.string()).max(3),
  next_week: z.array(z.string()).min(1).max(3),
});

/**
 * The same shape as a JSON Schema, for `output_config.format`.
 *
 * Written by hand rather than derived: the SDK's zod helper targets zod 4 and
 * this project is on zod 3 throughout. Keeping both means the model is
 * *constrained* by the schema on the way out and the response is *validated*
 * by zod on the way in — belt and braces on the one boundary here that is not
 * deterministic.
 */
const REVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'One sentence on how the last four weeks went.',
    },
    wins: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string' },
      description: 'Things that went well, each grounded in a given number.',
    },
    watch: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string' },
      description: 'Things worth attention, each with its reason.',
    },
    next_week: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string' },
      description: 'Concrete, specific suggestions for the coming week.',
    },
  },
  required: ['headline', 'wins', 'watch', 'next_week'],
  additionalProperties: false,
} as const;

export type WeeklyReview = z.infer<typeof reviewSchema>;

interface ReviewContext {
  windowDays: number;
  sessions: number;
  totalVolumeKg: number;
  adherencePercent: number | null;
  currentStreakWeeks: number;
  personalBests: { exercise: string; weight: number; reps: number }[];
  fatigue: { level: string; reasons: string[] };
}

@Injectable()
export class AiReviewService {
  private readonly logger = new Logger(AiReviewService.name);

  constructor(
    @InjectModel('AiRecommendation')
    private readonly recommendationModel: Model<unknown>,
    @InjectModel('WorkoutSession')
    private readonly sessionModel: Model<unknown>,
    private readonly workoutStats: WorkoutStatsService,
    private readonly mailer: NodemailerService,
    private readonly anthropic: AnthropicService,
  ) {}

  get enabled(): boolean {
    return this.anthropic.enabled;
  }

  /**
   * Gathers the derived numbers a review is written from.
   *
   * Returns `null` when there is not enough to say anything true. A review
   * generated from two sessions would be filler, and filler is what teaches
   * people to ignore a weekly email.
   */
  async buildContext(userId: string): Promise<ReviewContext | null> {
    const [stats, fatigue, sessions] = await Promise.all([
      this.workoutStats.getStats(userId, 28),
      this.workoutStats.getFatigueSignal(userId),
      this.sessionModel
        .find({
          userId: new Types.ObjectId(userId),
          performedAt: { $gte: new Date(Date.now() - 28 * 24 * 3600 * 1000) },
        })
        .select('exercises')
        .lean<
          { exercises?: { sets?: { reps: number; weight: number }[] }[] }[]
        >()
        .exec(),
    ]);

    if (sessions.length < 4) return null;

    let totalVolumeKg = 0;
    for (const session of sessions) {
      for (const exercise of session.exercises ?? []) {
        for (const set of exercise.sets ?? []) {
          totalVolumeKg += (set.weight || 0) * (set.reps || 0);
        }
      }
    }

    return {
      windowDays: 28,
      sessions: sessions.length,
      totalVolumeKg: Math.round(totalVolumeKg),
      adherencePercent: stats.adherence.percent,
      currentStreakWeeks: stats.streak.currentWeeks,
      personalBests: stats.personalBests
        .slice(0, 5)
        .map(({ exercise, weight, reps }) => ({ exercise, weight, reps })),
      fatigue: { level: fatigue.level, reasons: fatigue.reasons },
    };
  }

  /**
   * Asks Claude for the review.
   *
   * Adaptive thinking with `high` effort: this is four weeks of training data
   * being turned into advice a person will act on, which is worth reasoning
   * about, and it runs weekly rather than per request. It is the only AI call
   * in the app that pays for thinking — the other three are a parse, a
   * template fill and a chat turn, where it would buy nothing.
   *
   * Refusals, truncation, unparseable answers and an unreachable API are all
   * handled by `AnthropicService` and arrive here as `null`.
   */
  async generate(context: ReviewContext): Promise<{
    review: WeeklyReview;
    tokensUsed: number;
  } | null> {
    const result = await this.anthropic.complete({
      label: 'weekly-review',
      jsonSchema: REVIEW_JSON_SCHEMA,
      parser: reviewSchema,
      maxTokens: 16000,
      effort: 'high',
      thinking: true,
      system: [
        'You are a strength coach writing a short weekly review for one trainee.',
        'You are given derived statistics only — no identity, no free text from the user.',
        '',
        'Rules:',
        '- Every claim must follow from a number you were given. Never invent a lift, a date or a trend.',
        '- If the data does not support a point, leave it out rather than hedging.',
        '- Be specific: "add a set to your squats" beats "increase volume".',
        '- Do not give medical advice, diagnose injury, or discuss weight loss targets.',
        '- Write in Hebrew. Keep exercise names as they appear in the data.',
      ].join('\n'),
      prompt: `Here are the trainee's last ${context.windowDays} days:\n\n${JSON.stringify(context, null, 2)}`,
    });

    if (!result) return null;

    return { review: result.data, tokensUsed: result.tokensUsed };
  }

  /**
   * The whole flow for one user: gather, generate, store, notify.
   *
   * Returns `false` for every ordinary reason to do nothing — disabled, too
   * little data, an unparseable answer — so the caller can count outcomes
   * without treating them as failures.
   */
  async reviewUser(userId: string, email?: string): Promise<boolean> {
    if (!this.enabled) return false;

    const context = await this.buildContext(userId);
    if (!context) return false;

    const generated = await this.generate(context);
    if (!generated) return false;

    const { review, tokensUsed } = generated;

    await this.recommendationModel.create({
      userId,
      category: 'training',
      content: this.render(review),
      generatedBy: 'ai',
      aiModelUsed: DEFAULT_MODEL,
      metadata: {
        tokensUsed,
        version: 'weekly-review-1',
        tags: ['weekly', `fatigue:${context.fatigue.level}`],
      },
    });

    // Best effort: the review is already stored and will show in the app, and
    // an unreachable SMTP server is not a reason to lose it.
    if (email) {
      try {
        await this.mailer.sendWeeklyReview(email, this.render(review));
      } catch (error) {
        this.logger.warn(
          `Weekly review stored but not emailed: ${(error as Error).message}`,
        );
      }
    }

    return true;
  }

  /** Flattens the structured review into the text the collection stores. */
  private render(review: WeeklyReview): string {
    const section = (title: string, items: string[]) =>
      items.length > 0
        ? `${title}\n${items.map((i) => `• ${i}`).join('\n')}`
        : '';

    return [
      review.headline,
      section('מה עבד', review.wins),
      section('מה לשים לב אליו', review.watch),
      section('לשבוע הבא', review.next_week),
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}
