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
  let sessionModel: { find: jest.Mock; distinct: jest.Mock };
  let planModel: { find: jest.Mock };

  const withData = (sessions: unknown[], plans: unknown[] = []) => {
    sessionModel.find.mockReturnValue(chain(sessions));
    planModel.find.mockReturnValue(chain(plans));
  };

  beforeEach(async () => {
    sessionModel = {
      find: jest.fn().mockReturnValue(chain([])),
      distinct: jest.fn().mockReturnValue({ exec: () => Promise.resolve([]) }),
    };
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
  describe('exercise history', () => {
    /** Typed accessors for the mongoose filters the service passed down. */
    const findFilter = (call: number): Record<string, unknown> =>
      (sessionModel.find.mock.calls as unknown[][])[call][0] as Record<
        string,
        unknown
      >;

    const distinctFilter = (call: number): Record<string, unknown> =>
      (sessionModel.distinct.mock.calls as unknown[][])[call][1] as Record<
        string,
        unknown
      >;

    const withNames = (names: string[]) =>
      sessionModel.distinct.mockReturnValue({
        exec: () => Promise.resolve(names),
      });

    it('returns nothing for a malformed user id without querying', async () => {
      const history = await service.getExerciseHistory('not-an-id', 'Squat');
      expect(history.points).toEqual([]);
      expect(history.availableExercises).toEqual([]);
      expect(sessionModel.find).not.toHaveBeenCalled();
    });

    it('plots one point per day trained, oldest first', async () => {
      withNames(['Squat']);
      withData([
        session(daysAgo(20), [
          { name: 'Squat', sets: [{ reps: 5, weight: 100 }] },
        ]),
        session(daysAgo(6), [
          { name: 'Squat', sets: [{ reps: 5, weight: 110 }] },
        ]),
      ]);

      const { points } = await service.getExerciseHistory(USER, 'Squat');

      expect(points).toHaveLength(2);
      expect(points[0].date < points[1].date).toBe(true);
      expect(points[1].weight).toBe(110);
    });

    // Five sets on one day describe that day's strength once, not five times —
    // otherwise a high-volume day looks like a week of progress.
    it('collapses a day to its best set but sums the whole day volume', async () => {
      withNames(['Squat']);
      withData([
        session(daysAgo(3), [
          {
            name: 'Squat',
            sets: [
              { reps: 5, weight: 100 },
              { reps: 3, weight: 120 },
              { reps: 8, weight: 80 },
            ],
          },
        ]),
      ]);

      const { points } = await service.getExerciseHistory(USER, 'Squat');

      expect(points).toHaveLength(1);
      expect(points[0].sets).toBe(3);
      expect(points[0].volume).toBe(5 * 100 + 3 * 120 + 8 * 80);
      // Epley ranks 120x3 (132) above 100x5 (116.7) and 80x8 (101.3).
      expect(points[0].weight).toBe(120);
      expect(points[0].reps).toBe(3);
    });

    it('marks a day a personal best only against what came before it', async () => {
      withNames(['Bench']);
      withData([
        session(daysAgo(30), [
          { name: 'Bench', sets: [{ reps: 5, weight: 80 }] },
        ]),
        session(daysAgo(20), [
          { name: 'Bench', sets: [{ reps: 5, weight: 70 }] },
        ]),
        session(daysAgo(10), [
          { name: 'Bench', sets: [{ reps: 5, weight: 90 }] },
        ]),
      ]);

      const { points } = await service.getExerciseHistory(USER, 'Bench');

      expect(points.map((p) => p.isPersonalBest)).toEqual([true, false, true]);
    });

    it('treats differently-cased names as one exercise', async () => {
      withNames(['Bench Press']);
      withData([
        session(daysAgo(9), [
          { name: 'Bench Press', sets: [{ reps: 5, weight: 60 }] },
        ]),
        session(daysAgo(2), [
          { name: 'bench press', sets: [{ reps: 5, weight: 65 }] },
        ]),
      ]);

      const { points } = await service.getExerciseHistory(USER, 'Bench Press');
      expect(points).toHaveLength(2);
    });

    it('ignores other exercises in the same session', async () => {
      withNames(['Squat', 'Curl']);
      withData([
        session(daysAgo(4), [
          { name: 'Squat', sets: [{ reps: 5, weight: 100 }] },
          { name: 'Curl', sets: [{ reps: 12, weight: 15 }] },
        ]),
      ]);

      const { points } = await service.getExerciseHistory(USER, 'Squat');
      expect(points).toHaveLength(1);
      expect(points[0].sets).toBe(1);
    });

    it('skips sets with no load or no reps', async () => {
      withNames(['Plank']);
      withData([
        session(daysAgo(4), [
          { name: 'Plank', sets: [{ reps: 0, weight: 0 }] },
        ]),
      ]);

      const { points } = await service.getExerciseHistory(USER, 'Plank');
      expect(points).toEqual([]);
    });

    // Opening on an empty chart when there is data to show would read as a bug.
    it('defaults to the exercise logged on the most days', async () => {
      withNames(['Squat', 'Curl']);
      withData([
        session(daysAgo(9), [
          { name: 'Squat', sets: [{ reps: 5, weight: 100 }] },
          { name: 'Curl', sets: [{ reps: 10, weight: 15 }] },
        ]),
        session(daysAgo(2), [
          { name: 'Squat', sets: [{ reps: 5, weight: 105 }] },
        ]),
      ]);

      const history = await service.getExerciseHistory(USER);
      expect(history.exercise).toBe('Squat');
      expect(history.points).toHaveLength(2);
    });

    it('lists every logged exercise for the picker, sorted', async () => {
      withNames(['Squat', 'Bench', 'Row']);
      withData([]);

      const { availableExercises } = await service.getExerciseHistory(USER);
      expect(availableExercises).toEqual(['Bench', 'Row', 'Squat']);
    });

    // The window bounds the curve; narrowing it must not empty the picker that
    // chose the exercise being looked at.
    it('applies the window to the curve but not to the exercise list', async () => {
      withNames(['Squat', 'Deadlift']);
      withData([]);

      await service.getExerciseHistory(USER, 'Squat', 90);

      const curveFilter = findFilter(0) as { performedAt?: { $gte: Date } };
      expect(curveFilter.performedAt?.$gte).toBeInstanceOf(Date);
      expect(distinctFilter(0)).not.toHaveProperty('performedAt');
    });

    it('reads the whole log when no window is given', async () => {
      withNames(['Squat']);
      withData([]);

      await service.getExerciseHistory(USER, 'Squat');

      expect(findFilter(0)).not.toHaveProperty('performedAt');
    });

    it('has no curve for a user who has never trained', async () => {
      withNames([]);
      withData([]);

      const history = await service.getExerciseHistory(USER);
      expect(history.exercise).toBe('');
      expect(history.points).toEqual([]);
    });
  });
});
