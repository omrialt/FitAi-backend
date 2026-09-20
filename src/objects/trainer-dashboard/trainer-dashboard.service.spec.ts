import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TrainerDashboardService } from './trainer-dashboard.service';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';
import { WorkoutStatsService } from '../workout-session/workout-stats.service';
import type { TrainerAlertCode } from './trainer-dashboard.types';

const TRAINER = new Types.ObjectId().toString();
const CLIENT = new Types.ObjectId();
const OTHER_CLIENT = new Types.ObjectId();

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

/** `find(...).select(...).lean().exec()` in one stub. */
function findChain(value: unknown) {
  const chain = {
    select: () => chain,
    lean: () => chain,
    exec: () => Promise.resolve(value),
  };
  return chain;
}

interface Fixture {
  sessions?: Record<string, unknown>[];
  weightWindow?: Record<string, unknown>[];
  weightTotals?: Record<string, unknown>[];
  plans?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  roster?: string[];
  fatigue?: 'insufficient' | 'ok' | 'watch' | 'deload';
}

describe('TrainerDashboardService', () => {
  let service: TrainerDashboardService;
  let trainerAccess: { listClientIds: jest.Mock };
  let workoutStats: { getFatigueSignal: jest.Mock };
  let userModel: { find: jest.Mock };
  let sessionModel: { aggregate: jest.Mock };
  let physicalDataModel: { aggregate: jest.Mock };
  let trainingPlanModel: { find: jest.Mock };

  /**
   * Wires one scenario. The two physical-data aggregations are told apart by
   * their pipeline — the windowed one is the only one with a `$sort` stage —
   * so a test cannot accidentally answer the wrong question.
   */
  function given(fixture: Fixture) {
    trainerAccess.listClientIds.mockResolvedValue(
      fixture.roster ?? [CLIENT.toString()],
    );
    userModel.find.mockReturnValue(
      findChain(
        fixture.users ?? [
          {
            _id: CLIENT,
            fullName: 'Dana Client',
            email: 'dana@example.com',
            avatarUrl: null,
          },
        ],
      ),
    );
    sessionModel.aggregate.mockResolvedValue(fixture.sessions ?? []);
    physicalDataModel.aggregate.mockImplementation(
      (pipeline: Record<string, unknown>[]) => {
        const windowed = pipeline.some((stage) => '$sort' in stage);
        return Promise.resolve(
          windowed
            ? (fixture.weightWindow ?? [])
            : (fixture.weightTotals ?? []),
        );
      },
    );
    trainingPlanModel.find.mockReturnValue(findChain(fixture.plans ?? []));
    workoutStats.getFatigueSignal.mockResolvedValue({
      level: fixture.fatigue ?? 'ok',
    });
  }

  /** Codes on the first row — the assertion nearly every test makes. */
  async function codes(): Promise<TrainerAlertCode[]> {
    const rows = await service.getOverview(TRAINER);
    return rows[0].alerts.map((alert) => alert.code);
  }

  /** A client who trains, weighs in and has a plan: no alerts at all. */
  const healthy: Fixture = {
    sessions: [
      {
        _id: CLIENT,
        lastWorkoutAt: daysAgo(1),
        total: 40,
        last7: 3,
        last14: 6,
        last30: 12,
        daysTrainedLast30: ['2026-09-01', '2026-09-03'],
      },
    ],
    weightWindow: [
      {
        _id: CLIENT,
        firstKg: 80,
        firstAt: daysAgo(30),
        lastKg: 77,
        lastAt: daysAgo(1),
        count: 6,
      },
    ],
    weightTotals: [{ _id: CLIENT, count: 6 }],
    plans: [{ userId: CLIENT, days: [{ dayOfWeek: 1 }, { dayOfWeek: 4 }] }],
  };

  beforeEach(async () => {
    trainerAccess = { listClientIds: jest.fn() };
    workoutStats = { getFatigueSignal: jest.fn() };
    userModel = { find: jest.fn() };
    sessionModel = { aggregate: jest.fn() };
    physicalDataModel = { aggregate: jest.fn() };
    trainingPlanModel = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainerDashboardService,
        { provide: TrainerAccessService, useValue: trainerAccess },
        { provide: WorkoutStatsService, useValue: workoutStats },
        { provide: getModelToken('User'), useValue: userModel },
        { provide: getModelToken('WorkoutSession'), useValue: sessionModel },
        { provide: getModelToken('PhysicalData'), useValue: physicalDataModel },
        { provide: getModelToken('TrainingPlan'), useValue: trainingPlanModel },
      ],
    }).compile();

    service = module.get(TrainerDashboardService);
  });

  describe('the roster', () => {
    it('is the accepted connections and nothing else', async () => {
      trainerAccess.listClientIds.mockResolvedValue([]);

      await expect(service.getOverview(TRAINER)).resolves.toEqual([]);
      // No roster, no queries — a trainer with no clients should not touch
      // four collections to be told so.
      expect(sessionModel.aggregate).not.toHaveBeenCalled();
      expect(userModel.find).not.toHaveBeenCalled();
    });

    it('asks for exactly the client ids the access service returned', async () => {
      given({ ...healthy, roster: [CLIENT.toString()] });

      await service.getOverview(TRAINER);

      const [filter] = userModel.find.mock.calls[0] as [
        { _id: { $in: Types.ObjectId[] } },
      ];
      expect(filter._id.$in.map(String)).toEqual([CLIENT.toString()]);
      expect(filter._id.$in.map(String)).not.toContain(OTHER_CLIENT.toString());
    });

    it('leaves a healthy client with no alerts', async () => {
      given(healthy);
      await expect(codes()).resolves.toEqual([]);
    });
  });

  describe('training alerts', () => {
    const idle = (days: number): Fixture => ({
      ...healthy,
      sessions: [
        {
          ...healthy.sessions![0],
          lastWorkoutAt: daysAgo(days),
          last7: 0,
          last14: 0,
        },
      ],
    });

    it('says nothing at six days', async () => {
      given(idle(6));
      await expect(codes()).resolves.toEqual([]);
    });

    it('is an info at nine days and a warn at ten', async () => {
      given(idle(9));
      const rows = await service.getOverview(TRAINER);
      expect(rows[0].alerts).toEqual([
        expect.objectContaining({ code: 'missed_workouts', severity: 'info' }),
      ]);

      given(idle(10));
      const escalated = await service.getOverview(TRAINER);
      expect(escalated[0].alerts).toEqual([
        expect.objectContaining({ code: 'missed_workouts', severity: 'warn' }),
      ]);
    });

    it('calls a client who never trained never_trained, not missed', async () => {
      given({ ...healthy, sessions: [] });

      const rows = await service.getOverview(TRAINER);
      expect(rows[0].alerts.map((a) => a.code)).toContain('never_trained');
      expect(rows[0].alerts.map((a) => a.code)).not.toContain(
        'missed_workouts',
      );
      // Never trained is `null` days, not zero — zero reads as "today".
      expect(rows[0].daysSinceLastWorkout).toBeNull();
    });

    it('does not ask for a fatigue signal it knows will be insufficient', async () => {
      given(idle(20));

      const rows = await service.getOverview(TRAINER);

      expect(workoutStats.getFatigueSignal).not.toHaveBeenCalled();
      expect(rows[0].fatigue).toBe('insufficient');
    });

    it('surfaces a deload the fatigue signal asked for', async () => {
      given({ ...healthy, fatigue: 'deload' });
      await expect(codes()).resolves.toContain('deload_suggested');
    });
  });

  describe('weight alerts', () => {
    const weighIns = (
      firstKg: number,
      lastKg: number,
      spanDays: number,
      count = 2,
    ): Fixture => ({
      ...healthy,
      weightWindow: [
        {
          _id: CLIENT,
          firstKg,
          firstAt: daysAgo(spanDays),
          lastKg,
          lastAt: daysAgo(0),
          count,
        },
      ],
      weightTotals: [{ _id: CLIENT, count }],
    });

    it('calls half a kilo over thirty days stalled', async () => {
      given(weighIns(80, 80.2, 30));
      await expect(codes()).resolves.toContain('weight_stalled');
    });

    it('does not call the same pair six days apart stalled', async () => {
      given(weighIns(80, 80.2, 6));
      await expect(codes()).resolves.not.toContain('weight_stalled');
    });

    it('does not call real movement stalled', async () => {
      given(weighIns(80, 77.5, 30));
      await expect(codes()).resolves.not.toContain('weight_stalled');
    });

    it('treats one weigh-in as no comparison, not as zero change', async () => {
      given({
        ...healthy,
        weightWindow: [
          {
            _id: CLIENT,
            firstKg: 80,
            firstAt: daysAgo(30),
            lastKg: 80,
            lastAt: daysAgo(30),
            count: 1,
          },
        ],
        weightTotals: [{ _id: CLIENT, count: 1 }],
      });

      await expect(codes()).resolves.not.toContain('weight_stalled');
    });

    it('reports a client who never weighed in, and says nothing about a plateau', async () => {
      given({ ...healthy, weightWindow: [], weightTotals: [] });

      const alerts = await codes();
      expect(alerts).toContain('no_measurements');
      expect(alerts).not.toContain('weight_stalled');
    });

    it('does not report no_measurements for someone whose weigh-ins are merely old', async () => {
      // Nothing inside the 56-day window, but eleven rows before it: the
      // record exists, it is just not recent.
      given({
        ...healthy,
        weightWindow: [],
        weightTotals: [{ _id: CLIENT, count: 11 }],
      });

      await expect(codes()).resolves.not.toContain('no_measurements');
    });
  });

  describe('plan alerts and adherence', () => {
    it('reports a client with no active plan and leaves adherence null', async () => {
      given({ ...healthy, plans: [] });

      const rows = await service.getOverview(TRAINER);
      expect(rows[0].alerts.map((a) => a.code)).toContain('no_active_plan');
      // Not 0% — there is nothing to be adherent to.
      expect(rows[0].adherencePercent).toBeNull();
      expect(rows[0].hasActivePlan).toBe(false);
    });

    it('counts distinct days against the planned weekdays, capped at 100', async () => {
      given({
        ...healthy,
        plans: [{ userId: CLIENT, days: [{ dayOfWeek: 1 }] }],
        sessions: [
          {
            ...healthy.sessions![0],
            // Twelve distinct days against roughly four planned Mondays.
            daysTrainedLast30: Array.from(
              { length: 12 },
              (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`,
            ),
          },
        ],
      });

      const rows = await service.getOverview(TRAINER);
      expect(rows[0].adherencePercent).toBe(100);
    });

    it('ignores the null the aggregation pads out-of-window sessions with', async () => {
      given({
        ...healthy,
        plans: [{ userId: CLIENT, days: [{ dayOfWeek: 0 }, { dayOfWeek: 3 }] }],
        sessions: [
          {
            ...healthy.sessions![0],
            daysTrainedLast30: [null, '2026-09-01', null],
          },
        ],
      });

      const rows = await service.getOverview(TRAINER);
      // One day trained, not three: the nulls are out-of-window rows.
      expect(rows[0].adherencePercent).toBeGreaterThan(0);
      expect(rows[0].adherencePercent).toBeLessThan(50);
    });
  });

  describe('ordering', () => {
    it('puts the client with more warnings first', async () => {
      const quiet = new Types.ObjectId();
      given({
        roster: [CLIENT.toString(), quiet.toString()],
        users: [
          // Deliberately listed with the quiet client first, so a pass-through
          // order would fail this test.
          { _id: quiet, fullName: 'Quiet', email: 'q@example.com' },
          { _id: CLIENT, fullName: 'Loud', email: 'l@example.com' },
        ],
        sessions: [
          {
            _id: quiet,
            lastWorkoutAt: daysAgo(1),
            total: 30,
            last7: 3,
            last14: 6,
            last30: 12,
            daysTrainedLast30: ['2026-09-01'],
          },
        ],
        weightTotals: [
          { _id: quiet, count: 4 },
          { _id: CLIENT, count: 4 },
        ],
        plans: [{ userId: quiet, days: [{ dayOfWeek: 1 }] }],
      });

      const rows = await service.getOverview(TRAINER);

      expect(rows[0].fullName).toBe('Loud');
      expect(rows[0].alerts.length).toBeGreaterThan(rows[1].alerts.length);
    });
  });
});
