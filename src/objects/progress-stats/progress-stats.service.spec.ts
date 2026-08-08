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
    trainingPlanModel.aggregate.mock.calls[0][0];

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
      trainingPlanModel.aggregate.mockReturnValue(
        chain([{ _id: '2026-07-01' }, { _id: '2026-07-03' }]),
      );

      await expect(calc(7)).resolves.toMatchObject({ workoutsCompleted: 2 });
    });
  });

  describe('workout counting across both sources', () => {
    beforeEach(() => {
      physicalDataModel.find.mockReturnValue(chain([]));
      physicalDataModel.findOne.mockReturnValue(chain(null));
    });

    it('counts days logged as workout sessions', async () => {
      trainingPlanModel.aggregate.mockReturnValue(chain([]));
      workoutSessionModel.aggregate.mockReturnValue(
        chain([{ _id: '2026-08-01' }, { _id: '2026-08-02' }]),
      );

      await expect(calc(7)).resolves.toMatchObject({ workoutsCompleted: 2 });
    });

    it('adds legacy plan history that has not been backfilled yet', async () => {
      workoutSessionModel.aggregate.mockReturnValue(
        chain([{ _id: '2026-08-01' }]),
      );
      trainingPlanModel.aggregate.mockReturnValue(
        chain([{ _id: '2026-08-05' }]),
      );

      await expect(calc(7)).resolves.toMatchObject({ workoutsCompleted: 2 });
    });

    // The migration copies history into sessions without removing it, so
    // during the overlap both sources report the same day. It is one workout.
    it('does not double-count a day present in both sources', async () => {
      workoutSessionModel.aggregate.mockReturnValue(
        chain([{ _id: '2026-08-01' }, { _id: '2026-08-02' }]),
      );
      trainingPlanModel.aggregate.mockReturnValue(
        chain([{ _id: '2026-08-01' }, { _id: '2026-08-02' }]),
      );

      await expect(calc(7)).resolves.toMatchObject({ workoutsCompleted: 2 });
    });

    it('scopes the session aggregation to the requested user and window', async () => {
      trainingPlanModel.aggregate.mockReturnValue(chain([]));
      workoutSessionModel.aggregate.mockReturnValue(chain([]));

      await calc(7);

      const match = workoutSessionModel.aggregate.mock.calls[0][0][0].$match as
        | { userId?: Types.ObjectId; performedAt?: { $gte?: Date } }
        | undefined;

      expect(match?.userId?.toHexString()).toBe(userId);
      expect(match?.performedAt?.$gte).toBeInstanceOf(Date);
    });
  });

  describe('countWorkoutDays aggregation', () => {
    it('walks the real days[].exercises[].sets[].history[] path', async () => {
      physicalDataModel.find.mockReturnValue(chain([]));
      physicalDataModel.findOne.mockReturnValue(chain(null));
      trainingPlanModel.aggregate.mockReturnValue(chain([]));

      await calc(7);

      const pipeline = capturedPipeline();
      const unwound = pipeline
        .filter((stage) => '$unwind' in stage)
        .map((stage) => stage.$unwind);

      // Guards against silently returning 0 for everyone if a field is renamed
      expect(unwound).toEqual([
        '$days',
        '$days.exercises',
        '$days.exercises.sets',
        '$days.exercises.sets.history',
      ]);
    });

    it('scopes the aggregation to the requested user', async () => {
      physicalDataModel.find.mockReturnValue(chain([]));
      physicalDataModel.findOne.mockReturnValue(chain(null));
      trainingPlanModel.aggregate.mockReturnValue(chain([]));

      await calc(7);

      const match = capturedPipeline()[0].$match;
      expect(match?.userId).toBeInstanceOf(Types.ObjectId);
      expect(match?.userId?.toHexString()).toBe(userId);
    });
  });
});
