import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ProgressStatsService } from './progress-stats.service';

/**
 * Builds a stub that satisfies the `.find().sort().select().lean().exec()` and
 * `.findOne()...` chains the service uses, resolving to the supplied value.
 */
/** Aggregation stage shapes the assertions below need to read. */
interface PipelineStage {
  $unwind?: string;
  $match?: { userId?: Types.ObjectId };
}

function chain(result: unknown) {
  const link = {
    sort: () => link,
    select: () => link,
    lean: () => link,
    exec: () => Promise.resolve(result),
  };
  return link;
}

describe('ProgressStatsService', () => {
  const userId = new Types.ObjectId().toHexString();

  let service: ProgressStatsService;
  let physicalDataModel: { find: jest.Mock; findOne: jest.Mock };
  let trainingPlanModel: {
    aggregate: jest.Mock<unknown, [PipelineStage[]]>;
  };
  let workoutSessionModel: {
    aggregate: jest.Mock<unknown, [PipelineStage[]]>;
  };
  let progressStatsModel: Record<string, jest.Mock>;

  beforeEach(async () => {
    physicalDataModel = { find: jest.fn(), findOne: jest.fn() };
    trainingPlanModel = { aggregate: jest.fn<unknown, [PipelineStage[]]>() };
    workoutSessionModel = { aggregate: jest.fn<unknown, [PipelineStage[]]>() };
    // Most cases care about the legacy plan source; default the session source
    // to empty so each test only has to state what it is actually about.
    workoutSessionModel.aggregate.mockReturnValue(chain([]));
    progressStatsModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      find: jest.fn(),
      deleteOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressStatsService,
        {
          provide: getModelToken('ProgressStats'),
          useValue: progressStatsModel,
        },
        { provide: getModelToken('PhysicalData'), useValue: physicalDataModel },
        {
          provide: getModelToken('TrainingPlan'),
          useValue: trainingPlanModel,
        },
        {
          provide: getModelToken('WorkoutSession'),
          useValue: workoutSessionModel,
        },
      ],
    }).compile();

    service = module.get(ProgressStatsService);
  });

  /** The pipeline the service handed to Model.aggregate on its first call. */
  const capturedPipeline = (): PipelineStage[] =>
    workoutSessionModel.aggregate.mock.calls[0][0];

  /** Reach the private period calculation without going through Mongo. */
  const calc = (days: number) =>
    (
      service as unknown as {
        calculatePeriodStats: (u: string, d: number) => Promise<unknown>;
      }
    ).calculatePeriodStats(userId, days);

  describe('calculatePeriodStats', () => {
    it('diffs the latest in-window reading against the reading just before the window', async () => {
      physicalDataModel.find.mockReturnValue(
        chain([
          { weightKg: 81, bodyFatPercent: 20, dateRecorded: new Date() },
          { weightKg: 83, bodyFatPercent: 19, dateRecorded: new Date() },
        ]),
      );
      // Baseline lookups: weight, then body fat
      physicalDataModel.findOne
        .mockReturnValueOnce(chain({ weightKg: 80 }))
        .mockReturnValueOnce(chain({ bodyFatPercent: 22 }));
      trainingPlanModel.aggregate.mockReturnValue(chain([]));

      // 83 - 80 = +3 weight; 19 - 22 = -3 body fat
      await expect(calc(7)).resolves.toMatchObject({
        weightDiff: 3,
        fatDiff: -3,
      });
    });

    it('falls back to the earliest in-window reading when nothing precedes the window', async () => {
      physicalDataModel.find.mockReturnValue(
        chain([
          { weightKg: 70, dateRecorded: new Date() },
          { weightKg: 72.5, dateRecorded: new Date() },
        ]),
      );
      physicalDataModel.findOne.mockReturnValue(chain(null));
      trainingPlanModel.aggregate.mockReturnValue(chain([]));

      await expect(calc(30)).resolves.toMatchObject({ weightDiff: 2.5 });
    });

    it('reports no movement when there is a single reading and no baseline', async () => {
      physicalDataModel.find.mockReturnValue(
        chain([{ weightKg: 75, dateRecorded: new Date() }]),
      );
      physicalDataModel.findOne.mockReturnValue(chain(null));
      trainingPlanModel.aggregate.mockReturnValue(chain([]));

      await expect(calc(7)).resolves.toMatchObject({
        weightDiff: 0,
        fatDiff: 0,
      });
    });

    it('ignores readings that omit body fat when diffing fat', async () => {
      physicalDataModel.find.mockReturnValue(
        chain([
          { weightKg: 80, bodyFatPercent: 25, dateRecorded: new Date() },
          { weightKg: 79, dateRecorded: new Date() }, // no bodyFatPercent
        ]),
      );
      physicalDataModel.findOne.mockReturnValue(chain(null));
      trainingPlanModel.aggregate.mockReturnValue(chain([]));

      // Only one fat reading exists, so it is both baseline and latest -> 0,
      // and it must not be treated as a drop to zero.
      await expect(calc(7)).resolves.toMatchObject({ fatDiff: 0 });
    });

    it('returns zeros rather than NaN when the user has no measurements', async () => {
      physicalDataModel.find.mockReturnValue(chain([]));
      physicalDataModel.findOne.mockReturnValue(chain(null));
      trainingPlanModel.aggregate.mockReturnValue(chain([]));

      await expect(calc(7)).resolves.toEqual({
        weightDiff: 0,
        fatDiff: 0,
        workoutsCompleted: 0,
      });
    });

    it('rounds diffs to one decimal place', async () => {
      physicalDataModel.find.mockReturnValue(
        chain([{ weightKg: 80.06, dateRecorded: new Date() }]),
      );
      physicalDataModel.findOne
        .mockReturnValueOnce(chain({ weightKg: 80 }))
        .mockReturnValueOnce(chain(null));
      trainingPlanModel.aggregate.mockReturnValue(chain([]));

      await expect(calc(7)).resolves.toMatchObject({ weightDiff: 0.1 });
    });

    it('counts one workout per distinct day the user logged sets', async () => {
      physicalDataModel.find.mockReturnValue(chain([]));
      physicalDataModel.findOne.mockReturnValue(chain(null));
      // The aggregation groups by day, so each row is already a distinct day
      workoutSessionModel.aggregate.mockReturnValue(
        chain([{ _id: '2026-07-01' }, { _id: '2026-07-03' }]),
      );

      await expect(calc(7)).resolves.toMatchObject({ workoutsCompleted: 2 });
    });
  });

  /**
   * WorkoutSession is the only source now. The union with the legacy embedded
   * history was removed once the backfill was verified complete against
   * production — every embedded workout-day already existed as a session, so
   * the legacy branch contributed nothing.
   */
  describe('workout counting', () => {
    beforeEach(() => {
      physicalDataModel.find.mockReturnValue(chain([]));
      physicalDataModel.findOne.mockReturnValue(chain(null));
    });

    it('counts days logged as workout sessions', async () => {
      workoutSessionModel.aggregate.mockReturnValue(
        chain([{ _id: '2026-08-01' }, { _id: '2026-08-02' }]),
      );

      await expect(calc(7)).resolves.toMatchObject({ workoutsCompleted: 2 });
    });

    it('counts a repeated day once', async () => {
      workoutSessionModel.aggregate.mockReturnValue(
        chain([
          { _id: '2026-08-01' },
          { _id: '2026-08-01' },
          { _id: '2026-08-02' },
        ]),
      );

      await expect(calc(7)).resolves.toMatchObject({ workoutsCompleted: 2 });
    });

    // The plan collection must no longer be consulted for the workout count.
    // If a union creeps back in, this is what says so.
    it('does not read training plans to count workouts', async () => {
      workoutSessionModel.aggregate.mockReturnValue(chain([]));

      await calc(7);

      expect(trainingPlanModel.aggregate).not.toHaveBeenCalled();
    });

    it('scopes the session aggregation to the requested user and window', async () => {
      workoutSessionModel.aggregate.mockReturnValue(chain([]));

      await calc(7);

      const match = capturedPipeline()[0].$match as
        | { userId?: Types.ObjectId; performedAt?: { $gte?: Date } }
        | undefined;

      expect(match?.userId?.toHexString()).toBe(userId);
      expect(match?.performedAt?.$gte).toBeInstanceOf(Date);
    });

    it('groups by calendar day rather than by session', async () => {
      workoutSessionModel.aggregate.mockReturnValue(chain([]));

      await calc(7);

      // Two sessions on one day are one workout; grouping on the formatted
      // date is what makes that true.
      const group = capturedPipeline().find((stage) => '$group' in stage) as
        | { $group: { _id: unknown } }
        | undefined;

      expect(JSON.stringify(group?.$group._id)).toContain('%Y-%m-%d');
    });
  });

  describe('the workout count has one source', () => {
    // The regression this guards: `updateWorkoutCount` used to raise a stored
    // counter by a client-supplied number while `calculatePeriodStats` derived
    // the same figure from logged sessions. Two writers, one number, certain
    // drift. The manual one is gone and must not come back.
    it('exposes no method for incrementing the count by hand', () => {
      expect(
        (service as unknown as Record<string, unknown>).updateWorkoutCount,
      ).toBeUndefined();
    });

    it('regenerates the count from logged sessions, not from what was stored', async () => {
      const day = (iso: string) => ({ _id: iso });
      physicalDataModel.find.mockReturnValue(chain([]));
      physicalDataModel.findOne.mockReturnValue(chain(null));
      trainingPlanModel.aggregate.mockReturnValue(chain([]));
      workoutSessionModel.aggregate.mockReturnValue(
        chain([day('2026-08-01'), day('2026-08-02'), day('2026-08-03')]),
      );
      progressStatsModel.findOneAndUpdate.mockReturnValue({
        populate: () => ({ exec: () => Promise.resolve({ ok: true }) }),
      });

      await service.regenerateProgressStats(userId);

      // Whatever the document said before, the write carries the derived 3.
      const calls = progressStatsModel.findOneAndUpdate.mock.calls as Record<
        string,
        { workoutsCompleted: number }
      >[][];
      const written = calls[0][1];
      expect(written.last7Days.workoutsCompleted).toBe(3);
      expect(written.last30Days.workoutsCompleted).toBe(3);
    });
  });
});
