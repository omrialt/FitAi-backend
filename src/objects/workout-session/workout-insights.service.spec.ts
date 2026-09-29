import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { WorkoutInsightsService } from './workout-insights.service';

const USER = new Types.ObjectId().toHexString();

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

type Set = {
  reps: number;
  weight: number;
  rpe?: number;
  drops?: { reps: number; weight: number }[];
};

function session(
  day: string,
  dayName: string | undefined,
  exercises: { name: string; muscleGroup?: string; sets: Set[] }[],
  extra: { durationMinutes?: number; planTitle?: string } = {},
) {
  return {
    performedAt: new Date(`${day}T12:00:00Z`),
    dayName,
    ...extra,
    exercises,
  };
}

const bench = (weight: number, reps = 5, extra: Partial<Set> = {}) => ({
  name: 'Bench Press',
  muscleGroup: 'chest',
  sets: [{ weight, reps, ...extra }],
});
const incline = (weight: number) => ({
  name: 'Incline Dumbbell Press',
  muscleGroup: 'chest',
  sets: [{ weight, reps: 10 }],
});
const squat = (weight: number) => ({
  name: 'Back Squat',
  muscleGroup: 'legs',
  sets: [{ weight, reps: 5 }],
});

describe('WorkoutInsightsService', () => {
  let service: WorkoutInsightsService;
  let sessionModel: { find: jest.Mock };

  const withLog = (sessions: unknown[]) =>
    sessionModel.find.mockReturnValue(chain(sessions));

  beforeEach(async () => {
    sessionModel = { find: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutInsightsService,
        { provide: getModelToken('WorkoutSession'), useValue: sessionModel },
      ],
    }).compile();
    service = module.get(WorkoutInsightsService);
  });

  describe('getWorkoutTypes', () => {
    it('groups sessions by day name, case-insensitively, newest type first', async () => {
      withLog([
        session('2026-09-01', 'Upper A', [bench(80)]),
        session('2026-09-02', 'Lower', [squat(100)]),
        session('2026-09-08', 'upper a', [bench(82.5)]),
      ]);

      const { types } = await service.getWorkoutTypes(USER);

      expect(types.map((t) => [t.dayName, t.sessions])).toEqual([
        ['Upper A', 2],
        ['Lower', 1],
      ]);
    });

    it('keeps sessions logged without a day name as their own type', async () => {
      withLog([session('2026-09-01', undefined, [bench(80)])]);

      const { types } = await service.getWorkoutTypes(USER);

      expect(types).toHaveLength(1);
      expect(types[0].dayName).toBeNull();
      expect(types[0].volumeTrendPercent).toBeNull();
    });

    it('reports volume trend, frequency, duration and RPE', async () => {
      withLog([
        session('2026-09-01', 'Upper A', [bench(100, 5, { rpe: 7 })], {
          durationMinutes: 50,
        }),
        session('2026-09-08', 'Upper A', [bench(110, 5, { rpe: 9 })], {
          durationMinutes: 70,
        }),
      ]);

      const [upper] = (await service.getWorkoutTypes(USER)).types;

      expect(upper.volumeTrendPercent).toBe(10);
      expect(upper.perWeek).toBe(2);
      expect(upper.avgDurationMinutes).toBe(60);
      expect(upper.avgRpe).toBe(8);
      expect(upper.avgVolume).toBe(525);
      expect(upper.lastVolume).toBe(550);
    });

    it('counts drops toward volume but not toward strength', async () => {
      withLog([
        session('2026-09-01', 'Upper A', [bench(100)]),
        session('2026-09-08', 'Upper A', [
          bench(100, 5, { drops: [{ weight: 200, reps: 10 }] }),
        ]),
      ]);

      const [upper] = (await service.getWorkoutTypes(USER)).types;
      const [benchProgress] = upper.exercises;

      expect(upper.volumeTrendPercent).toBe(400);
      expect(benchProgress.lastE1rm).toBe(benchProgress.firstE1rm);
      expect(benchProgress.bestSet).toEqual({ weight: 100, reps: 5 });
    });

    it('names the most improved lift and flags stalled ones', async () => {
      withLog([
        session('2026-08-01', 'Push', [bench(80), incline(30)]),
        session('2026-08-08', 'Push', [bench(85), incline(30)]),
        session('2026-08-15', 'Push', [bench(90), incline(30)]),
        session('2026-08-22', 'Push', [bench(95), incline(30)]),
      ]);

      const [push] = (await service.getWorkoutTypes(USER)).types;

      expect(push.mostImproved).toBe('Bench Press');
      expect(push.stalled).toEqual(['Incline Dumbbell Press']);
      expect(push.exercises.find((e) => e.name === 'Bench Press')?.trend).toBe(
        'improving',
      );
    });

    it('calls a lift stalled when the recent run fails to beat its earlier best', async () => {
      withLog([
        session('2026-08-01', 'Push', [bench(80)]),
        session('2026-08-08', 'Push', [bench(100)]),
        session('2026-08-15', 'Push', [bench(95)]),
        session('2026-08-22', 'Push', [bench(97.5)]),
        session('2026-08-29', 'Push', [bench(97.5)]),
      ]);

      const [push] = (await service.getWorkoutTypes(USER)).types;

      // +22% overall, but nothing in the last three beat the 100kg day.
      expect(push.exercises[0].changePercent).toBeGreaterThan(20);
      expect(push.exercises[0].trend).toBe('stalled');
    });

    it('returns nothing for an invalid user id without querying', async () => {
      await expect(service.getWorkoutTypes('nope')).resolves.toEqual({
        types: [],
      });
      expect(sessionModel.find).not.toHaveBeenCalled();
    });
  });

  describe('getExerciseComparison', () => {
    const log = [
      session('2026-09-01', 'Upper A', [bench(80), incline(30), squat(100)]),
      session('2026-09-08', 'Upper A', [bench(85), incline(32)]),
      session('2026-09-15', 'Upper B', [bench(90)]),
    ];

    it('defaults to the muscle group with the most exercises', async () => {
      withLog(log);

      const result = await service.getExerciseComparison(USER);

      expect(result.muscleGroup).toBe('chest');
      expect(result.availableMuscleGroups).toEqual(['chest', 'legs']);
      expect(result.exercises.map((e) => [e.name, e.sessions])).toEqual([
        ['Bench Press', 3],
        ['Incline Dumbbell Press', 2],
      ]);
    });

    it('returns one e1RM point per day and the change since the first', async () => {
      withLog(log);

      const { exercises } = await service.getExerciseComparison(USER, 'Chest');
      const benchCurve = exercises[0];

      expect(benchCurve.points.map((p) => p.date)).toEqual([
        '2026-09-01',
        '2026-09-08',
        '2026-09-15',
      ]);
      expect(benchCurve.firstE1rm).toBe(93.3);
      expect(benchCurve.lastE1rm).toBe(105);
      expect(benchCurve.changePercent).toBe(12.5);
    });

    it('merges two sessions of the same lift on one day into one point', async () => {
      withLog([
        session('2026-09-01', 'AM', [bench(80)]),
        session('2026-09-01', 'PM', [bench(90, 3)]),
      ]);

      const { exercises } = await service.getExerciseComparison(USER, 'chest');

      expect(exercises[0].points).toHaveLength(1);
      // 90x3 (e1RM 99) beats 80x5 (93.3), so the PM set is the point.
      expect(exercises[0].points[0].weight).toBe(90);
      expect(exercises[0].points[0].volume).toBe(80 * 5 + 90 * 3);
    });

    it('applies the window to the curves but not to the picker', async () => {
      withLog([
        session('2020-01-01', 'Old', [squat(60)]),
        session(new Date().toISOString().slice(0, 10), 'Now', [bench(80)]),
      ]);

      const result = await service.getExerciseComparison(USER, 'legs', 30);

      expect(result.availableMuscleGroups).toEqual(['chest', 'legs']);
      expect(result.exercises).toEqual([]);
    });
  });
});
