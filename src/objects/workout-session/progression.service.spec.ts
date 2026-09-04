import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';

import { ProgressionService } from './progression.service';
import { WorkoutStatsService, FatigueSignal } from './workout-stats.service';
import { ExerciseService } from '../exercise/exercise.service';

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

function daysAgo(n: number): Date {
  const d = new Date(Date.now() - n * DAY_MS);
  d.setHours(12, 0, 0, 0);
  return d;
}

type Set = { reps: number; weight: number; rpe?: number };

function session(performedAt: Date, name: string, sets: Set[]) {
  return { performedAt, exercises: [{ name, sets }] };
}

const fatigue = (
  level: FatigueSignal['level'],
  reasons: FatigueSignal['reasons'] = [],
): FatigueSignal => ({
  level,
  reasons,
  volumeChangePercent: null,
  recentRpe: null,
  baselineRpe: null,
  recentSessions: 0,
  baselineSessions: 0,
});

describe('ProgressionService', () => {
  let service: ProgressionService;
  let sessionModel: { find: jest.Mock };
  let stats: { getFatigueSignal: jest.Mock };
  let exercises: { resolveByName: jest.Mock };

  beforeEach(async () => {
    sessionModel = { find: jest.fn().mockReturnValue(chain([])) };
    stats = { getFatigueSignal: jest.fn().mockResolvedValue(fatigue('ok')) };
    exercises = { resolveByName: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressionService,
        { provide: getModelToken('WorkoutSession'), useValue: sessionModel },
        { provide: WorkoutStatsService, useValue: stats },
        { provide: ExerciseService, useValue: exercises },
      ],
    }).compile();

    service = module.get(ProgressionService);
  });

  const withSessions = (rows: unknown[]) =>
    sessionModel.find.mockReturnValue(chain(rows));

  const equipment = (value: string) =>
    exercises.resolveByName.mockResolvedValue({ equipment: value });

  // ─── progressive overload ───────────────────────────────────

  describe('the overload coach', () => {
    /**
     * Double progression's whole rule. Reps 5–8 across the history, and the
     * last session hit 8 on every set, so the load moves and the reps reset
     * to the bottom of the range — not to 8 again at a heavier weight, which
     * would be two new things at once.
     */
    it('adds load once every set tops the rep range', async () => {
      equipment('barbell');
      withSessions([
        session(daysAgo(7), 'Bench Press', [
          { reps: 5, weight: 80 },
          { reps: 5, weight: 80 },
        ]),
        session(daysAgo(2), 'Bench Press', [
          { reps: 8, weight: 80 },
          { reps: 8, weight: 80 },
        ]),
      ]);

      const { suggestions } = await service.getOverloadPlan(USER);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toMatchObject({
        exercise: 'Bench Press',
        action: 'add_weight',
        reason: 'range_topped',
        repRange: { min: 5, max: 8 },
        suggested: { weight: 82.5, reps: 5, sets: 2 },
        incrementKg: 2.5,
        equipment: 'barbell',
      });
    });

    it('adds a rep while the range still has room', async () => {
      equipment('barbell');
      withSessions([
        session(daysAgo(7), 'Squat', [{ reps: 8, weight: 100 }]),
        session(daysAgo(2), 'Squat', [
          { reps: 6, weight: 100 },
          { reps: 5, weight: 100 },
        ]),
      ]);

      const { suggestions } = await service.getOverloadPlan(USER);

      expect(suggestions[0]).toMatchObject({
        action: 'add_reps',
        reason: 'range_not_topped',
        // One more than the *weakest* set — that is where the work is left.
        suggested: { weight: 100, reps: 6 },
      });
    });

    /**
     * The thing a naive double-progression implementation gets wrong. The reps
     * were there, so the rule says add weight; the effort says the load is
     * already at its ceiling. Adding on top of that is how a good week becomes
     * a stalled month.
     */
    it('holds when the reps were hit but the effort was maximal', async () => {
      equipment('barbell');
      withSessions([
        session(daysAgo(7), 'Deadlift', [{ reps: 5, weight: 140 }]),
        session(daysAgo(2), 'Deadlift', [
          { reps: 8, weight: 140, rpe: 9.5 },
          { reps: 8, weight: 140, rpe: 9.5 },
        ]),
      ]);

      const { suggestions } = await service.getOverloadPlan(USER);

      expect(suggestions[0]).toMatchObject({
        action: 'hold',
        reason: 'effort_high',
        lastRpe: 9.5,
      });
    });

    it('still adds load when the same reps felt comfortable', async () => {
      equipment('barbell');
      withSessions([
        session(daysAgo(7), 'Deadlift', [{ reps: 5, weight: 140 }]),
        session(daysAgo(2), 'Deadlift', [{ reps: 8, weight: 140, rpe: 7 }]),
      ]);

      const { suggestions } = await service.getOverloadPlan(USER);
      expect(suggestions[0].action).toBe('add_weight');
    });

    /**
     * The coupling that keeps the two features from contradicting each other
     * on the same screen. A coach that keeps saying "add weight" under a
     * deload banner has taught the user to ignore one of them, and it will
     * not be the coach.
     */
    it('holds everything while the fatigue signal says deload', async () => {
      equipment('barbell');
      stats.getFatigueSignal.mockResolvedValue(
        fatigue('deload', ['volume_dropping', 'effort_climbing']),
      );
      withSessions([
        session(daysAgo(7), 'Bench Press', [{ reps: 5, weight: 80 }]),
        session(daysAgo(2), 'Bench Press', [{ reps: 8, weight: 80 }]),
      ]);

      const plan = await service.getOverloadPlan(USER);

      expect(plan.deloadRecommended).toBe(true);
      expect(plan.suggestions[0]).toMatchObject({
        action: 'hold',
        reason: 'deloading',
      });
    });

    // The increment has to be a number the equipment can be set to. 2.5kg on
    // a machine whose stack moves in fives is a suggestion nobody can follow.
    it.each([
      ['barbell', 2.5, 82.5],
      ['machine', 5, 85],
      ['dumbbell', 2, 82],
      ['kettlebell', 4, 84],
    ])('adds %s-sized load (%pkg)', async (kit, increment, expected) => {
      equipment(kit);
      withSessions([
        session(daysAgo(7), 'Press', [{ reps: 5, weight: 80 }]),
        session(daysAgo(2), 'Press', [{ reps: 8, weight: 80 }]),
      ]);

      const { suggestions } = await service.getOverloadPlan(USER);

      expect(suggestions[0].incrementKg).toBe(increment);
      expect(suggestions[0].suggested.weight).toBe(expected);
    });

    // You cannot put 2.5kg on a pull-up, so the only axis left is reps.
    it('progresses a bodyweight lift by reps, never by load', async () => {
      equipment('bodyweight');
      withSessions([
        session(daysAgo(7), 'Pull Up', [{ reps: 5, weight: 0 }]),
        session(daysAgo(2), 'Pull Up', [{ reps: 8, weight: 0 }]),
      ]);

      const { suggestions } = await service.getOverloadPlan(USER);

      expect(suggestions[0]).toMatchObject({
        action: 'add_reps',
        reason: 'range_topped',
        incrementKg: 0,
      });
    });

    // Plans store whatever the user typed; the catalogue is allowed not to
    // know it, and the feature must still work.
    it('falls back to a barbell-sized step for an unrecognised name', async () => {
      exercises.resolveByName.mockResolvedValue(null);
      withSessions([
        session(daysAgo(7), 'Omri Special', [{ reps: 5, weight: 60 }]),
        session(daysAgo(2), 'Omri Special', [{ reps: 8, weight: 60 }]),
      ]);

      const { suggestions } = await service.getOverloadPlan(USER);

      expect(suggestions[0]).toMatchObject({
        incrementKg: 2.5,
        equipment: null,
        suggested: { weight: 62.5 },
      });
    });

    // One session is a data point, not a pattern.
    it('says nothing about an exercise logged only once', async () => {
      withSessions([session(daysAgo(2), 'Bench Press', [{ reps: 8, weight: 80 }])]);

      const { suggestions } = await service.getOverloadPlan(USER);
      expect(suggestions).toHaveLength(0);
    });

    /**
     * Two sets at 80 and one at 60 on the same day is one working weight and
     * a back-off set. Counting the 60 as part of the range would make the
     * range look wider than the person actually trains in, and would keep the
     * load pinned forever.
     */
    it('treats the heaviest weight of the day as the working load', async () => {
      equipment('barbell');
      withSessions([
        session(daysAgo(7), 'Row', [{ reps: 5, weight: 60 }]),
        session(daysAgo(2), 'Row', [
          { reps: 8, weight: 60 },
          { reps: 8, weight: 60 },
          { reps: 12, weight: 40 },
        ]),
      ]);

      const { suggestions } = await service.getOverloadPlan(USER);

      expect(suggestions[0].lastTopSet).toEqual({
        weight: 60,
        reps: 8,
        sets: 2,
      });
      // The back-off set is excluded from the range as well as from the load.
      // Counting its 12 reps would push the ceiling to 12, the top set would
      // never "top out", and the load would stay pinned at 60 forever.
      expect(suggestions[0].repRange).toEqual({ min: 5, max: 8 });
      expect(suggestions[0].suggested.weight).toBe(62.5);
    });

    it('narrows to one exercise when asked', async () => {
      withSessions([
        session(daysAgo(7), 'Squat', [{ reps: 5, weight: 100 }]),
        session(daysAgo(2), 'Squat', [{ reps: 5, weight: 100 }]),
        session(daysAgo(6), 'Bench Press', [{ reps: 5, weight: 80 }]),
        session(daysAgo(1), 'Bench Press', [{ reps: 5, weight: 80 }]),
      ]);

      const { suggestions } = await service.getOverloadPlan(USER, 'squat');

      expect(suggestions.map((s) => s.exercise)).toEqual(['Squat']);
    });

    it('returns nothing for an invalid user id rather than throwing', async () => {
      await expect(service.getOverloadPlan('not-an-id')).resolves.toEqual({
        suggestions: [],
        deloadRecommended: false,
      });
      expect(sessionModel.find).not.toHaveBeenCalled();
    });
  });

  // ─── deload ─────────────────────────────────────────────────

  describe('the deload prescription', () => {
    /**
     * `insufficient` is not `ok`. Prescribing rest from a signal that admits
     * it knows nothing is exactly the filler the fatigue detector was written
     * to avoid — and it is the state every user is in until RPE accrues.
     */
    it('prescribes nothing when the signal has too little data', async () => {
      stats.getFatigueSignal.mockResolvedValue(fatigue('insufficient'));

      const prescription = await service.getDeloadPrescription(USER);

      expect(prescription).toMatchObject({
        recommended: false,
        level: 'insufficient',
        exercises: [],
        durationDays: 0,
      });
      // No point reading the log to answer a question already settled.
      expect(sessionModel.find).not.toHaveBeenCalled();
    });

    it('prescribes nothing when training looks fine', async () => {
      stats.getFatigueSignal.mockResolvedValue(fatigue('ok'));

      const prescription = await service.getDeloadPrescription(USER);
      expect(prescription.recommended).toBe(false);
      expect(prescription.exercises).toHaveLength(0);
    });

    it('turns a deload signal into kilos and sets', async () => {
      stats.getFatigueSignal.mockResolvedValue(
        fatigue('deload', ['volume_dropping', 'effort_climbing']),
      );
      withSessions([
        session(daysAgo(3), 'Squat', [
          { reps: 5, weight: 100 },
          { reps: 5, weight: 100 },
          { reps: 5, weight: 100 },
          { reps: 5, weight: 100 },
        ]),
      ]);

      const prescription = await service.getDeloadPrescription(USER);

      expect(prescription).toMatchObject({
        recommended: true,
        level: 'deload',
        loadPercent: 80,
        volumePercent: 60,
        durationDays: 7,
      });
      expect(prescription.exercises[0]).toEqual({
        exercise: 'Squat',
        from: { weight: 100, sets: 4, reps: 5 },
        to: { weight: 80, sets: 2, reps: 5 },
      });
    });

    /**
     * `watch` gets the numbers but not the instruction — the difference
     * between an alarm and an option.
     */
    it('offers a lighter week on watch without recommending it', async () => {
      stats.getFatigueSignal.mockResolvedValue(
        fatigue('watch', ['frequency_dropping']),
      );
      withSessions([
        session(daysAgo(3), 'Squat', [
          { reps: 5, weight: 100 },
          { reps: 5, weight: 100 },
        ]),
      ]);

      const prescription = await service.getDeloadPrescription(USER);

      expect(prescription.recommended).toBe(false);
      expect(prescription).toMatchObject({ loadPercent: 90, volumePercent: 80 });
      expect(prescription.exercises[0].to).toEqual({
        weight: 90,
        sets: 2,
        reps: 5,
      });
    });

    /**
     * A deload that prescribes 68.4kg is a deload nobody performs, because a
     * barbell does not make that number. Rounding *down* keeps it a deload —
     * rounding to nearest could hand back load the week exists to remove.
     */
    it('rounds down to a weight a barbell can actually make', async () => {
      stats.getFatigueSignal.mockResolvedValue(fatigue('deload', ['load_stalled']));
      withSessions([
        session(daysAgo(3), 'Curl', [{ reps: 10, weight: 86 }]),
      ]);

      const prescription = await service.getDeloadPrescription(USER);
      // 86 x 0.8 = 68.8 -> 67.5, not 70.
      expect(prescription.exercises[0].to.weight).toBe(67.5);
    });

    // A deload is a lighter week, not a week off; dropping a lift to zero sets
    // loses the movement pattern entirely.
    it('never prescribes fewer than one set', async () => {
      stats.getFatigueSignal.mockResolvedValue(fatigue('deload', ['load_stalled']));
      withSessions([session(daysAgo(3), 'Curl', [{ reps: 10, weight: 20 }])]);

      const prescription = await service.getDeloadPrescription(USER);
      expect(prescription.exercises[0].to.sets).toBe(1);
    });
  });
});
