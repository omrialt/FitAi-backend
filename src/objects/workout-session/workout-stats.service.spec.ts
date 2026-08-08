import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { WorkoutStatsService } from './workout-stats.service';

const USER = new Types.ObjectId().toHexString();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Satisfies `.find().sort().select().lean().exec()`. */
function chain(result: unknown) {
  const link = {
    sort: () => link,
    select: () => link,
    lean: () => link,
    exec: () => Promise.resolve(result),
  };
  return link;
}

/** A date N days before now, at midday so timezone drift cannot shift the day. */
function daysAgo(n: number): Date {
  const d = new Date(Date.now() - n * DAY_MS);
  d.setHours(12, 0, 0, 0);
  return d;
}

function session(
  performedAt: Date,
  exercises: { name: string; sets: { reps: number; weight: number }[] }[] = [],
) {
  return { performedAt, exercises };
}

describe('WorkoutStatsService', () => {
  let service: WorkoutStatsService;
  let sessionModel: { find: jest.Mock };
  let planModel: { find: jest.Mock };

  const withData = (sessions: unknown[], plans: unknown[] = []) => {
    sessionModel.find.mockReturnValue(chain(sessions));
    planModel.find.mockReturnValue(chain(plans));
  };

  beforeEach(async () => {
    sessionModel = { find: jest.fn().mockReturnValue(chain([])) };
    planModel = { find: jest.fn().mockReturnValue(chain([])) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutStatsService,
        { provide: getModelToken('WorkoutSession'), useValue: sessionModel },
        { provide: getModelToken('TrainingPlan'), useValue: planModel },
      ],
    }).compile();

    service = module.get(WorkoutStatsService);
  });

  it('returns empty stats for a malformed user id without querying', async () => {
    const stats = await service.getStats('not-an-id');
    expect(stats.personalBests).toEqual([]);
    expect(stats.streak.currentWeeks).toBe(0);
    expect(sessionModel.find).not.toHaveBeenCalled();
  });

  it('returns empty stats for a user who has never trained', async () => {
    withData([]);
    const stats = await service.getStats(USER);
    expect(stats.streak.totalWorkoutDays).toBe(0);
    expect(stats.streak.lastWorkoutAt).toBeNull();
    expect(stats.adherence.completed).toBe(0);
  });

  describe('streaks', () => {
    it('counts consecutive weeks, not consecutive days', async () => {
      // Three weeks running, training twice a week — a day-based streak would
      // report 1 here, which is the whole reason weeks are the unit.
      withData([
        session(daysAgo(18)),
        session(daysAgo(15)),
        session(daysAgo(11)),
        session(daysAgo(8)),
        session(daysAgo(4)),
        session(daysAgo(1)),
      ]);

      const { streak } = await service.getStats(USER);
      expect(streak.currentWeeks).toBeGreaterThanOrEqual(3);
      expect(streak.longestWeeks).toBeGreaterThanOrEqual(3);
    });

    it('counts several sessions in one day as one training day', async () => {
      const today = daysAgo(0);
      const laterToday = new Date(today.getTime() + 3 * 60 * 60 * 1000);
      withData([session(today), session(laterToday)]);

      const { streak } = await service.getStats(USER);
      expect(streak.totalWorkoutDays).toBe(1);
    });

    it('reports no current streak after a long absence, but keeps the record', async () => {
      withData([session(daysAgo(200)), session(daysAgo(193))]);

      const { streak } = await service.getStats(USER);
      expect(streak.currentWeeks).toBe(0);
      expect(streak.longestWeeks).toBe(2);
    });

    // Without the grace period the number would collapse to zero every Monday
    // until the first session of the week.
    it('keeps the streak alive when the last workout was last week', async () => {
      withData([session(daysAgo(14)), session(daysAgo(8))]);

      const { streak } = await service.getStats(USER);
      expect(streak.currentWeeks).toBeGreaterThanOrEqual(1);
    });
  });

  describe('adherence', () => {
    it('is null when no active plan defines what was planned', async () => {
      withData([session(daysAgo(2))], []);

      const { adherence } = await service.getStats(USER, 30);
      expect(adherence.percent).toBeNull();
      expect(adherence.planned).toBe(0);
      expect(adherence.completed).toBe(1);
    });

    it('counts planned sessions from the active plan weekdays', async () => {
      // Three training days a week over 28 days ≈ 12 planned sessions.
      withData(
        [],
        [{ days: [{ dayOfWeek: 1 }, { dayOfWeek: 3 }, { dayOfWeek: 5 }] }],
      );

      const { adherence } = await service.getStats(USER, 28);
      expect(adherence.planned).toBe(12);
      expect(adherence.percent).toBe(0);
    });

    it('never exceeds 100% when the user trains more than planned', async () => {
      withData(
        Array.from({ length: 20 }, (_, i) => session(daysAgo(i))),
        [{ days: [{ dayOfWeek: 1 }] }],
      );

      const { adherence } = await service.getStats(USER, 30);
      expect(adherence.percent).toBe(100);
    });

    it('ignores sessions older than the window', async () => {
      withData([session(daysAgo(90)), session(daysAgo(3))], []);

      const { adherence } = await service.getStats(USER, 30);
      expect(adherence.completed).toBe(1);
    });
  });

  describe('personal bests', () => {
    it('ranks a hard set of five above a heavy single', async () => {
      withData([
        session(daysAgo(10), [
          { name: 'Squat', sets: [{ reps: 1, weight: 100 }] },
        ]),
        session(daysAgo(3), [
          // 100 x 5 → e1RM ≈ 116.7, which beats 100 x 1 → 103.3
          { name: 'Squat', sets: [{ reps: 5, weight: 100 }] },
        ]),
      ]);

      const { personalBests } = await service.getStats(USER);
      expect(personalBests).toHaveLength(1);
      expect(personalBests[0]).toMatchObject({ reps: 5, weight: 100 });
      expect(personalBests[0].estimatedOneRepMax).toBeCloseTo(116.7, 1);
    });

    it('keeps one entry per exercise and sorts strongest first', async () => {
      withData([
        session(daysAgo(2), [
          { name: 'Bench', sets: [{ reps: 5, weight: 60 }] },
          { name: 'Deadlift', sets: [{ reps: 3, weight: 140 }] },
        ]),
      ]);

      const { personalBests } = await service.getStats(USER);
      expect(personalBests.map((p) => p.exercise)).toEqual([
        'Deadlift',
        'Bench',
      ]);
    });

    it('skips bodyweight or unlogged sets that carry no load', async () => {
      withData([
        session(daysAgo(1), [
          { name: 'Plank', sets: [{ reps: 0, weight: 0 }] },
          { name: 'Row', sets: [{ reps: 8, weight: 50 }] },
        ]),
      ]);

      const { personalBests } = await service.getStats(USER);
      expect(personalBests.map((p) => p.exercise)).toEqual(['Row']);
    });

    it('records when the best was achieved, not when it was queried', async () => {
      const when = daysAgo(9);
      withData([
        session(when, [{ name: 'Press', sets: [{ reps: 5, weight: 40 }] }]),
      ]);

      const { personalBests } = await service.getStats(USER);
      expect(personalBests[0].achievedAt.toISOString()).toBe(
        when.toISOString(),
      );
    });
  });
});
