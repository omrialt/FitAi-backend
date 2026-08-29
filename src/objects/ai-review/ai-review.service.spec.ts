import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';

import { AiReviewService } from './ai-review.service';
import { WorkoutStatsService } from '../workout-session/workout-stats.service';
import { NodemailerService } from '../../common/nodemailer/nodemailer.service';

const USER = new Types.ObjectId().toHexString();

function chain(result: unknown) {
  const link = {
    select: () => link,
    lean: () => link,
    exec: () => Promise.resolve(result),
  };
  return link;
}

const fullStats = {
  streak: {
    currentWeeks: 3,
    longestWeeks: 5,
    totalWorkoutDays: 20,
    lastWorkoutAt: new Date(),
  },
  adherence: { planned: 12, completed: 9, percent: 75, windowDays: 28 },
  personalBests: [
    {
      exercise: 'Bench Press',
      weight: 80,
      reps: 5,
      estimatedOneRepMax: 93.3,
      achievedAt: new Date(),
    },
  ],
};

const okFatigue = { level: 'ok', reasons: [] };

describe('AiReviewService', () => {
  let service: AiReviewService;
  let recommendationModel: { create: jest.Mock };
  let sessionModel: { find: jest.Mock };
  let stats: { getStats: jest.Mock; getFatigueSignal: jest.Mock };
  let mailer: { sendWeeklyReview: jest.Mock };

  const build = async () => {
    recommendationModel = { create: jest.fn().mockResolvedValue({}) };
    sessionModel = { find: jest.fn().mockReturnValue(chain([])) };
    stats = {
      getStats: jest.fn().mockResolvedValue(fullStats),
      getFatigueSignal: jest.fn().mockResolvedValue(okFatigue),
    };
    mailer = { sendWeeklyReview: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiReviewService,
        {
          provide: getModelToken('AiRecommendation'),
          useValue: recommendationModel,
        },
        { provide: getModelToken('WorkoutSession'), useValue: sessionModel },
        { provide: WorkoutStatsService, useValue: stats },
        { provide: NodemailerService, useValue: mailer },
      ],
    }).compile();

    service = module.get(AiReviewService);
  };

  const sessions = (count: number) =>
    Array.from({ length: count }, () => ({
      exercises: [{ sets: [{ reps: 5, weight: 100 }] }],
    }));

  describe('without an API key', () => {
    beforeEach(async () => {
      delete process.env.ANTHROPIC_API_KEY;
      await build();
    });

    /**
     * The property that makes this safe to deploy: the first thing in the
     * project that costs money per use does not switch itself on merely by
     * being present.
     */
    it('reports itself disabled', () => {
      expect(service.enabled).toBe(false);
    });

    it('does nothing at all, and does not throw', async () => {
      sessionModel.find.mockReturnValue(chain(sessions(10)));

      await expect(service.reviewUser(USER, 'a@b.test')).resolves.toBe(false);
      expect(recommendationModel.create).not.toHaveBeenCalled();
      expect(mailer.sendWeeklyReview).not.toHaveBeenCalled();
    });
  });

  describe('with an API key', () => {
    beforeEach(async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real';
      await build();
    });

    afterEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
    });

    it('reports itself enabled', () => {
      expect(service.enabled).toBe(true);
    });

    // Filler is what teaches people to ignore a weekly email.
    it('skips a user with too little logged training, before any API call', async () => {
      sessionModel.find.mockReturnValue(chain(sessions(2)));

      expect(await service.buildContext(USER)).toBeNull();
      await expect(service.reviewUser(USER)).resolves.toBe(false);
      expect(recommendationModel.create).not.toHaveBeenCalled();
    });

    it('builds a context from derived numbers only', async () => {
      sessionModel.find.mockReturnValue(chain(sessions(8)));

      const context = await service.buildContext(USER);

      expect(context).toEqual({
        windowDays: 28,
        sessions: 8,
        totalVolumeKg: 8 * 500,
        adherencePercent: 75,
        currentStreakWeeks: 3,
        personalBests: [{ exercise: 'Bench Press', weight: 80, reps: 5 }],
        fatigue: { level: 'ok', reasons: [] },
      });
    });

    /**
     * The prompt must carry no identity. A training summary does not need to
     * know who it is about, so the context object is asserted to contain
     * nothing that could identify anyone.
     */
    it('puts no identifying information in the context', async () => {
      sessionModel.find.mockReturnValue(chain(sessions(8)));

      const context = await service.buildContext(USER);
      const serialised = JSON.stringify(context);

      expect(serialised).not.toContain(USER);
      expect(serialised.toLowerCase()).not.toContain('email');
      expect(serialised.toLowerCase()).not.toContain('name');
    });

    it('stores the review with its provenance when generation succeeds', async () => {
      sessionModel.find.mockReturnValue(chain(sessions(8)));
      jest.spyOn(service, 'generate').mockResolvedValue({
        review: {
          headline: 'שבוע יציב',
          wins: ['נפח עלה'],
          watch: [],
          next_week: ['הוסף סט לסקוואט'],
        },
        tokensUsed: 1234,
      });

      await expect(service.reviewUser(USER, 'a@b.test')).resolves.toBe(true);

      const [doc] = recommendationModel.create.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(doc.generatedBy).toBe('ai');
      expect(doc.aiModelUsed).toBe('claude-opus-5');
      expect((doc.metadata as { tokensUsed: number }).tokensUsed).toBe(1234);
      expect(doc.content).toContain('שבוע יציב');
      expect(mailer.sendWeeklyReview).toHaveBeenCalledWith(
        'a@b.test',
        expect.stringContaining('שבוע יציב'),
      );
    });

    // The review is already stored and visible in the app; an unreachable SMTP
    // server is not a reason to report failure and re-bill a regeneration.
    it('keeps the stored review when the email fails', async () => {
      sessionModel.find.mockReturnValue(chain(sessions(8)));
      jest.spyOn(service, 'generate').mockResolvedValue({
        review: { headline: 'ok', wins: [], watch: [], next_week: ['x'] },
        tokensUsed: 10,
      });
      mailer.sendWeeklyReview.mockRejectedValue(new Error('smtp down'));

      await expect(service.reviewUser(USER, 'a@b.test')).resolves.toBe(true);
      expect(recommendationModel.create).toHaveBeenCalled();
    });

    it('writes nothing when the model returns something unusable', async () => {
      sessionModel.find.mockReturnValue(chain(sessions(8)));
      jest.spyOn(service, 'generate').mockResolvedValue(null);

      await expect(service.reviewUser(USER)).resolves.toBe(false);
      expect(recommendationModel.create).not.toHaveBeenCalled();
    });
  });
});
