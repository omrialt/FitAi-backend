import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';

import { HealthProbeService } from './health-probe.service';
import { AlertService } from './alert.service';

/**
 * The probes exist because of one incident: a deploy shipped email
 * verification before the backfill that marks existing accounts verified, and
 * three accounts could not log in. Nothing alerted, because nothing errored —
 * every one of those requests was a well-formed 403.
 *
 * So the assertion that matters is not "does it pass when healthy" but "does
 * it fail, and raise an alert, when the thing it watches is broken". A probe
 * that can only pass is decoration.
 */
describe('HealthProbeService', () => {
  let service: HealthProbeService;
  let userModel: { countDocuments: jest.Mock };
  let trainingPlanModel: { aggregate: jest.Mock };
  let alerts: { raise: jest.Mock };
  let ping: jest.Mock;

  const aggregateResult = (rows: unknown[]) => ({
    exec: () => Promise.resolve(rows),
  });

  beforeEach(async () => {
    ping = jest.fn().mockResolvedValue({ ok: 1 });
    userModel = { countDocuments: jest.fn().mockResolvedValue(0) };
    trainingPlanModel = {
      aggregate: jest.fn().mockReturnValue(aggregateResult([])),
    };
    alerts = { raise: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthProbeService,
        {
          provide: getConnectionToken(),
          useValue: { db: { admin: () => ({ ping }) } },
        },
        { provide: getModelToken('User'), useValue: userModel },
        {
          provide: getModelToken('TrainingPlan'),
          useValue: trainingPlanModel,
        },
        { provide: AlertService, useValue: alerts },
      ],
    }).compile();

    service = module.get(HealthProbeService);
  });

  const resultFor = (results: { name: string; ok: boolean }[], name: string) =>
    results.find((r) => r.name === name);

  it('passes every check when the system is healthy', async () => {
    const results = await service.runAll();

    expect(results.every((r) => r.ok)).toBe(true);
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  describe('database', () => {
    it('fails, and alerts, when the database does not answer', async () => {
      ping.mockRejectedValue(new Error('connection timed out'));

      const results = await service.runAll();

      // The failure surfaces as a probe-error entry rather than a thrown
      // request, and the remaining checks still run.
      expect(results.some((r) => !r.ok)).toBe(true);
      expect(alerts.raise).toHaveBeenCalled();
    });

    it('does not let one failing probe hide the others', async () => {
      ping.mockRejectedValue(new Error('down'));

      const results = await service.runAll();

      expect(
        results.map((r) => r.name).includes('stranded-unverified-accounts'),
      ).toBe(true);
    });
  });

  describe('stranded unverified accounts', () => {
    // This is the incident, reproduced.
    it('fails and alerts when accounts are locked out', async () => {
      userModel.countDocuments.mockResolvedValue(3);

      const results = await service.runAll();
      const probe = resultFor(results, 'stranded-unverified-accounts');

      expect(probe?.ok).toBe(false);
      expect(alerts.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          fingerprint: 'probe:stranded-unverified-accounts',
          // `expect.objectContaining` is typed as `any`; narrowing it keeps
          // the file free of unsafe-assignment errors.
          detail: expect.objectContaining({ count: 3 }) as unknown,
        }),
      );
    });

    it('only counts email accounts old enough to be genuinely stuck', async () => {
      await service.runAll();

      const calls = userModel.countDocuments.mock.calls as unknown[][];
      const filter = calls[0][0] as {
        emailVerified: boolean;
        authProvider: string;
        createdAt: { $lt: Date };
      };

      expect(filter.emailVerified).toBe(false);
      // Google sets the flag at signup — those accounts are exactly the ones
      // that survived the incident and must not be reported as stranded.
      expect(filter.authProvider).toBe('email');
      expect(filter.createdAt.$lt).toBeInstanceOf(Date);
      expect(filter.createdAt.$lt.getTime()).toBeLessThan(Date.now());
    });
  });

  describe('unmigrated workout history', () => {
    it('fails when embedded history has no matching session', async () => {
      trainingPlanModel.aggregate.mockReturnValue(
        aggregateResult([{ unmigrated: 4 }]),
      );

      const results = await service.runAll();
      const probe = resultFor(results, 'unmigrated-workout-history');

      expect(probe?.ok).toBe(false);
      expect(alerts.raise).toHaveBeenCalledWith(
        expect.objectContaining({
          fingerprint: 'probe:unmigrated-workout-history',
        }),
      );
    });

    /**
     * The bug this replaced: counting plans that still contain embedded
     * history reported 2 against production while the number of genuinely
     * unmigrated workout-days was 0, because the backfill copies rather than
     * moves. The pipeline must therefore join against the sessions, not just
     * count plans.
     */
    it('joins against workout sessions rather than counting plans', async () => {
      await service.runAll();

      const calls = trainingPlanModel.aggregate.mock.calls as unknown[][];
      const pipeline = calls[0][0] as Record<string, unknown>[];
      const lookup = pipeline.find((stage) => '$lookup' in stage) as
        | { $lookup: { from: string } }
        | undefined;

      expect(lookup?.$lookup.from).toBe('workoutsessions');
    });
  });
});
