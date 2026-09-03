import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

import { TemplateService } from './template.service';
import {
  PERIODIZATION_TEMPLATES,
  TEMPLATE_IDS,
} from './periodization-templates';
import { EXERCISE_CATALOG } from '../exercise/exercise-catalog';
import { ExerciseService } from '../exercise/exercise.service';
import { WorkoutStatsService } from '../workout-session/workout-stats.service';

const USER = new Types.ObjectId().toHexString();

const emptyStats = {
  streak: {
    currentWeeks: 0,
    longestWeeks: 0,
    totalWorkoutDays: 0,
    lastWorkoutAt: null,
  },
  adherence: { planned: 0, completed: 0, percent: null, windowDays: 30 },
  personalBests: [] as unknown[],
};

describe('TemplateService', () => {
  let service: TemplateService;
  let exercises: { findBySlug: jest.Mock };
  let stats: { getStats: jest.Mock };

  /** The real catalogue, looked up by slug — these two ship together. */
  const catalogue = new Map(EXERCISE_CATALOG.map((e) => [e.slug, e]));

  beforeEach(async () => {
    exercises = {
      findBySlug: jest
        .fn()
        .mockImplementation((slug: string) => catalogue.get(slug) ?? null),
    };
    stats = { getStats: jest.fn().mockResolvedValue(emptyStats) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateService,
        { provide: ExerciseService, useValue: exercises },
        { provide: WorkoutStatsService, useValue: stats },
      ],
    }).compile();

    service = module.get(TemplateService);
  });

  // ─── the shipped data ───────────────────────────────────────

  describe('the shipped templates', () => {
    /**
     * The test that earns its place. Templates reference exercises by slug and
     * nothing type-checks a string against the catalogue, so a typo — or a
     * catalogue rename — produces a plan with an exercise called
     * "lying-leg-curl" and no muscle group, silently. This caught exactly that
     * while the templates were being written: `leg-curl` does not exist.
     */
    it('references only exercises the catalogue actually ships', () => {
      const known = new Set(EXERCISE_CATALOG.map((e) => e.slug));

      const missing = PERIODIZATION_TEMPLATES.flatMap((template) =>
        template.days.flatMap((day) =>
          day.exercises
            .map((exercise) => exercise.slug)
            .filter((slug) => !known.has(slug)),
        ),
      );

      expect(missing).toEqual([]);
    });

    it('is bilingual everywhere the user can see', () => {
      for (const template of PERIODIZATION_TEMPLATES) {
        expect(template.nameHe).toBeTruthy();
        expect(template.descriptionHe).toBeTruthy();
        for (const day of template.days) {
          expect(day.nameHe).toBeTruthy();
        }
      }
    });

    it('declares a day count that matches the days it has', () => {
      for (const template of PERIODIZATION_TEMPLATES) {
        expect(template.days).toHaveLength(template.daysPerWeek);
      }
    });

    it('lists every template without shipping its days to the picker', () => {
      const listed = service.list();

      expect(listed.map((t) => t.id).sort()).toEqual([...TEMPLATE_IDS].sort());
      expect(listed[0]).not.toHaveProperty('days');
    });

    it('rejects an unknown template id', () => {
      expect(() => service.get('not-a-programme')).toThrow(BadRequestException);
    });
  });

  // ─── materialising ──────────────────────────────────────────

  describe('building a plan', () => {
    it('writes exercise names in Hebrew by default', async () => {
      const plan = await service.build({
        templateId: 'upper-lower',
        userId: USER,
      });

      expect(plan.title).toBe('פלג גוף עליון / תחתון');
      expect(plan.days?.[0].dayName).toBe('פלג גוף עליון');
      expect(plan.days?.[0].exercises[0].name).toBe(
        catalogue.get('barbell-bench-press')!.nameHe,
      );
    });

    it('writes them in English when asked', async () => {
      const plan = await service.build({
        templateId: 'upper-lower',
        userId: USER,
        language: 'en',
      });

      expect(plan.days?.[0].exercises[0].name).toBe('Barbell Bench Press');
    });

    // The catalogue's muscle group rides along, which is the thing free-text
    // plans have never had and what makes a templated plan groupable.
    it('fills the muscle group from the catalogue', async () => {
      const plan = await service.build({ templateId: 'ppl', userId: USER });

      expect(plan.days?.[0].exercises[0].muscleGroup).toBe('chest');
    });

    /**
     * 5/3/1 prescribes 85% of a max nobody has typed in anywhere. The
     * estimated 1RM is already computed for the personal-bests card, so the
     * plan can open with real loads instead of zeros.
     */
    it('turns a percentage into a real weight from the user history', async () => {
      stats.getStats.mockResolvedValue({
        ...emptyStats,
        personalBests: [
          {
            exercise: 'לחיצת חזה במוט',
            weight: 90,
            reps: 3,
            estimatedOneRepMax: 100,
            achievedAt: new Date(),
          },
        ],
      });

      const plan = await service.build({
        templateId: 'wendler-531',
        userId: USER,
      });

      const bench = plan.days
        ?.flatMap((day) => day.exercises)
        .find((e) => e.name === 'לחיצת חזה במוט');

      // 65 / 75 / 85 percent of 100, rounded to what a barbell makes.
      expect(bench?.sets.map((s) => s.targetWeight)).toEqual([65, 75, 85]);
    });

    it('matches the personal best across languages', async () => {
      stats.getStats.mockResolvedValue({
        ...emptyStats,
        personalBests: [
          {
            // Logged in English; the plan is being written in Hebrew.
            exercise: 'Barbell Bench Press',
            weight: 90,
            reps: 3,
            estimatedOneRepMax: 100,
            achievedAt: new Date(),
          },
        ],
      });

      const plan = await service.build({
        templateId: 'wendler-531',
        userId: USER,
      });

      const bench = plan.days
        ?.flatMap((day) => day.exercises)
        .find((e) => e.name === 'לחיצת חזה במוט');

      expect(bench?.sets[0].targetWeight).toBe(65);
    });

    /**
     * Guessing a starting weight for someone who has never performed the lift
     * is how a plan gets a person injured. Zero renders as an empty field with
     * a plate calculator next to it, which is the honest answer.
     */
    it('leaves the weight at zero for a lift with no history', async () => {
      const plan = await service.build({
        templateId: 'wendler-531',
        userId: USER,
      });

      const weights = plan.days
        ?.flatMap((day) => day.exercises)
        .flatMap((e) => e.sets.map((s) => s.targetWeight));

      expect(weights?.every((w) => w === 0)).toBe(true);
    });

    it('spreads a four-day cycle over four distinct weekdays', async () => {
      const plan = await service.build({
        templateId: 'upper-lower',
        userId: USER,
      });

      const weekdays = plan.days?.map((day) => day.dayOfWeek) ?? [];
      expect(weekdays).toHaveLength(4);
      expect(new Set(weekdays).size).toBe(4);
      expect(weekdays.every((d) => d >= 0 && d <= 6)).toBe(true);
    });

    it('honours the weekdays the caller chose', async () => {
      const plan = await service.build({
        templateId: 'upper-lower',
        userId: USER,
        weekdays: [1, 2, 4, 5],
      });

      expect(plan.days?.map((day) => day.dayOfWeek)).toEqual([1, 2, 4, 5]);
    });

    /**
     * A four-day programme squeezed into two days is not that programme.
     * Silently dropping half of it would be worse than ignoring the request.
     */
    it('ignores a weekday list that does not fit the programme', async () => {
      const plan = await service.build({
        templateId: 'upper-lower',
        userId: USER,
        weekdays: [1, 2],
      });

      expect(plan.days).toHaveLength(4);
      expect(new Set(plan.days?.map((d) => d.dayOfWeek)).size).toBe(4);
    });

    // It is the user's plan from the moment it exists — no link back, no sync.
    it('produces a plain owned plan with no tie to the template', async () => {
      const plan = await service.build({ templateId: 'ppl', userId: USER });

      expect(plan.userId).toBe(USER);
      expect(plan.isActive).toBe(true);
      expect(plan).not.toHaveProperty('templateId');
      expect(plan).not.toHaveProperty('syncWithParent');
    });

    it('reads each distinct exercise from the catalogue only once', async () => {
      await service.build({ templateId: 'ppl', userId: USER });

      const asked = exercises.findBySlug.mock.calls.map(([slug]) => slug);
      // PPL names lateral raises and triceps pushdowns on more than one day.
      expect(asked.length).toBe(new Set(asked).size);
    });
  });
});
