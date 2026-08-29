import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';

import { ExerciseService } from './exercise.service';
import { EXERCISE_CATALOG } from './exercise-catalog';
import { MUSCLE_GROUPS, EQUIPMENT, exerciseSchema } from './exercise.schema';

/** Satisfies `.find().sort().limit().lean().exec()`. */
function chain(result: unknown) {
  const link = {
    sort: () => link,
    limit: () => link,
    lean: () => link,
    exec: () => Promise.resolve(result),
  };
  return link;
}

function findOneChain(result: unknown) {
  const link = {
    lean: () => link,
    exec: () => Promise.resolve(result),
  };
  return link;
}

describe('ExerciseService', () => {
  let service: ExerciseService;
  let model: { find: jest.Mock; findOne: jest.Mock };

  const findFilter = (call = 0): Record<string, unknown> =>
    (model.find.mock.calls as unknown[][])[call][0] as Record<string, unknown>;

  beforeEach(async () => {
    model = {
      find: jest.fn().mockReturnValue(chain([])),
      findOne: jest.fn().mockReturnValue(findOneChain(null)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExerciseService,
        { provide: getModelToken('Exercise'), useValue: model },
      ],
    }).compile();

    service = module.get(ExerciseService);
  });

  describe('search', () => {
    it('returns the whole catalogue page when nothing is asked for', async () => {
      await service.search();
      expect(findFilter()).toEqual({});
    });

    it('matches the term against both names and the aliases', async () => {
      await service.search({ search: 'bench' });

      const or = findFilter().$or as { [k: string]: RegExp }[];
      expect(or.map((clause) => Object.keys(clause)[0])).toEqual([
        'nameEn',
        'nameHe',
        'aliases',
      ]);
      expect(or[0].nameEn.source).toBe('bench');
      expect(or[0].nameEn.flags).toContain('i');
    });

    // Without escaping, a user typing "(" builds an invalid regex and the
    // request 500s on what is just a stray keystroke in a search box.
    it('escapes regex metacharacters in the search term', async () => {
      await service.search({ search: 'row (bent)' });

      const or = findFilter().$or as { [k: string]: RegExp }[];
      expect(or[0].nameEn.source).toBe('row \\(bent\\)');
      expect(() => new RegExp(or[0].nameEn.source)).not.toThrow();
    });

    it('ignores a term that is only whitespace', async () => {
      await service.search({ search: '   ' });
      expect(findFilter()).toEqual({});
    });

    // A user browsing "triceps" wants the bench press listed, even though the
    // catalogue files it under chest.
    it('matches a muscle group as either primary or secondary', async () => {
      await service.search({ muscleGroup: 'triceps' });

      const and = findFilter().$and as { $or: Record<string, string>[] }[];
      expect(and[0].$or).toEqual([
        { primaryMuscle: 'triceps' },
        { secondaryMuscles: 'triceps' },
      ]);
    });

    it('filters by equipment exactly', async () => {
      await service.search({ equipment: 'barbell' });
      expect(findFilter().equipment).toBe('barbell');
    });

    it('combines a term, a muscle group and equipment', async () => {
      await service.search({
        search: 'press',
        muscleGroup: 'chest',
        equipment: 'dumbbell',
      });

      const filter = findFilter();
      expect(filter.$or).toBeDefined();
      expect(filter.$and).toBeDefined();
      expect(filter.equipment).toBe('dumbbell');
    });
  });

  describe('resolveByName', () => {
    it('is null for an empty or blank name, without querying', async () => {
      expect(await service.resolveByName('   ')).toBeNull();
      expect(model.findOne).not.toHaveBeenCalled();
    });

    it('matches a name exactly, in either language or an alias', async () => {
      model.findOne.mockReturnValue(findOneChain({ slug: 'deadlift' }));

      await service.resolveByName('הרמת מתים');

      const filter = (model.findOne.mock.calls as unknown[][])[0][0] as {
        $or: { [k: string]: RegExp }[];
      };
      expect(filter.$or.map((c) => Object.keys(c)[0])).toEqual([
        'nameHe',
        'nameEn',
        'aliases',
      ]);
      // Anchored: an exact string, never a substring.
      expect(filter.$or[0].nameHe.source).toBe('^הרמת מתים$');
      expect(filter.$or[0].nameHe.flags).toContain('i');
    });

    it('escapes regex characters in free text from a plan', async () => {
      model.findOne.mockReturnValue(findOneChain(null));

      await service.resolveByName('Row (bent)');

      const filter = (model.findOne.mock.calls as unknown[][])[0][0] as {
        $or: { [k: string]: RegExp }[];
      };
      expect(() => new RegExp(filter.$or[0].nameHe.source)).not.toThrow();
    });
  });

  describe('alternativesForName', () => {
    // `null` is an ordinary outcome meaning "hide the button", not an error.
    it('returns no match and no alternatives for an unknown name', async () => {
      model.findOne.mockReturnValue(findOneChain(null));

      const result = await service.alternativesForName('סחיבת צמיג');

      expect(result).toEqual({ matched: null, alternatives: [] });
      expect(model.find).not.toHaveBeenCalled();
    });

    it('finds same-muscle substitutes for a recognised name', async () => {
      model.findOne.mockReturnValue(
        findOneChain({ slug: 'back-squat', primaryMuscle: 'quads' }),
      );
      model.find.mockReturnValue(chain([{ slug: 'leg-press' }]));

      const result = await service.alternativesForName('סקוואט');

      expect(findFilter()).toEqual({
        slug: { $ne: 'back-squat' },
        primaryMuscle: 'quads',
      });
      expect(result.matched?.slug).toBe('back-squat');
      expect(result.alternatives).toHaveLength(1);
    });

    it('narrows to the equipment that is actually free', async () => {
      model.findOne.mockReturnValue(
        findOneChain({ slug: 'back-squat', primaryMuscle: 'quads' }),
      );

      await service.alternativesForName('סקוואט', { equipment: 'dumbbell' });

      expect(findFilter().equipment).toBe('dumbbell');
    });
  });

  describe('alternatives', () => {
    it('is empty for a slug that does not exist', async () => {
      model.findOne.mockReturnValue(findOneChain(null));

      expect(await service.alternatives('no-such-exercise')).toEqual([]);
      expect(model.find).not.toHaveBeenCalled();
    });

    it('asks for the same primary muscle, excluding the exercise itself', async () => {
      model.findOne.mockReturnValue(
        findOneChain({ slug: 'back-squat', primaryMuscle: 'quads' }),
      );

      await service.alternatives('back-squat');

      expect(findFilter()).toEqual({
        slug: { $ne: 'back-squat' },
        primaryMuscle: 'quads',
      });
    });
  });
});

/**
 * The catalogue ships with the app, so a malformed entry is a deploy-time bug
 * rather than a runtime one. Validating it here means a bad row fails CI
 * instead of failing the seed script against a live database.
 */
describe('exercise catalogue', () => {
  it('is not empty', () => {
    expect(EXERCISE_CATALOG.length).toBeGreaterThan(50);
  });

  it('has a unique slug for every entry', () => {
    const slugs = EXERCISE_CATALOG.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses url-safe slugs', () => {
    for (const entry of EXERCISE_CATALOG) {
      expect(entry.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('validates every entry against the schema', () => {
    for (const entry of EXERCISE_CATALOG) {
      const result = exerciseSchema.safeParse(entry);
      if (!result.success) {
        throw new Error(`${entry.slug}: ${result.error.message}`);
      }
    }
  });

  it('only uses known muscle groups and equipment', () => {
    for (const entry of EXERCISE_CATALOG) {
      expect(MUSCLE_GROUPS).toContain(entry.primaryMuscle);
      expect(EQUIPMENT).toContain(entry.equipment);
      for (const muscle of entry.secondaryMuscles) {
        expect(MUSCLE_GROUPS).toContain(muscle);
      }
    }
  });

  it('never repeats the primary muscle in the secondary list', () => {
    for (const entry of EXERCISE_CATALOG) {
      expect(entry.secondaryMuscles).not.toContain(entry.primaryMuscle);
    }
  });

  // A muscle group nothing trains is a filter that returns an empty screen.
  it('covers every muscle group with at least one exercise', () => {
    const covered = new Set(EXERCISE_CATALOG.map((e) => e.primaryMuscle));
    for (const group of MUSCLE_GROUPS) {
      expect(covered).toContain(group);
    }
  });

  it('carries both a Hebrew and an English name for every entry', () => {
    for (const entry of EXERCISE_CATALOG) {
      expect(entry.nameHe.trim().length).toBeGreaterThan(1);
      expect(entry.nameEn.trim().length).toBeGreaterThan(1);
      expect(entry.nameHe).toMatch(/[֐-׿]/);
    }
  });
});
