/**
 * Load the exercise catalogue into MongoDB.
 *
 *   npm run seed:exercises
 *   npm run seed:exercises:dry
 *
 * Idempotent by design: every row is upserted on `slug`, so running it twice
 * reports the same catalogue and changes nothing the second time. That matters
 * because this runs on deploy — a seed that duplicates rows on a re-run is a
 * seed nobody dares to run.
 *
 * It does not delete. An exercise removed from the catalogue file stays in the
 * database, because a user's plan may already name it and silently dropping it
 * would break search for that user with no way back. Pass `--prune` to remove
 * catalogue rows that are no longer in the file, once you are sure.
 *
 * Nothing here touches user data. Training plans keep their free-text
 * `muscleGroup`; the catalogue only offers canonical values to autocomplete.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

import { ExerciseSchema } from '../src/objects/exercise/exercise.schema';
import { EXERCISE_CATALOG } from '../src/objects/exercise/exercise-catalog';

interface Args {
  dryRun: boolean;
  prune: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    prune: args.includes('--prune'),
  };
}

/** A duplicate slug would make the upsert silently drop an exercise. */
function assertUniqueSlugs(): void {
  const seen = new Set<string>();
  for (const entry of EXERCISE_CATALOG) {
    if (seen.has(entry.slug)) {
      throw new Error(`Duplicate slug in the catalogue: ${entry.slug}`);
    }
    seen.add(entry.slug);
  }
}

async function main(): Promise<void> {
  const { dryRun, prune } = parseArgs();

  assertUniqueSlugs();

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set — refusing to guess a database.');
  }

  await mongoose.connect(uri);
  const Exercise = mongoose.model('Exercise', ExerciseSchema);

  const before = await Exercise.countDocuments();
  console.log(
    `Catalogue: ${EXERCISE_CATALOG.length} exercises. Collection currently holds ${before}.`,
  );

  if (dryRun) {
    const slugs = new Set(EXERCISE_CATALOG.map((e) => e.slug));
    const existing = await Exercise.find({ slug: { $in: [...slugs] } })
      .select('slug')
      .lean<{ slug: string }[]>();
    const existingSlugs = new Set(existing.map((e) => e.slug));

    const toInsert = [...slugs].filter((s) => !existingSlugs.has(s));
    console.log(
      `[dry run] would insert ${toInsert.length}, would update ${existingSlugs.size}.`,
    );
    if (toInsert.length) console.log(`[dry run] new: ${toInsert.join(', ')}`);

    await mongoose.disconnect();
    return;
  }

  const result = await Exercise.bulkWrite(
    EXERCISE_CATALOG.map((entry) => ({
      updateOne: {
        filter: { slug: entry.slug },
        update: { $set: entry },
        upsert: true,
      },
    })),
  );

  console.log(
    `Upserted ${result.upsertedCount}, updated ${result.modifiedCount}.`,
  );

  if (prune) {
    const slugs = EXERCISE_CATALOG.map((e) => e.slug);
    const removed = await Exercise.deleteMany({ slug: { $nin: slugs } });
    console.log(`Pruned ${removed.deletedCount} exercises not in the file.`);
  }

  const after = await Exercise.countDocuments();
  console.log(`Collection now holds ${after}.`);

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
