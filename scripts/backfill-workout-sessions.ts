/**
 * Backfill the WorkoutSession collection from history embedded in training plans.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-workout-sessions.ts [--dry-run]
 *
 * Reads `TrainingPlan.days[].exercises[].sets[].history[]` and rebuilds one
 * session per (plan, day, calendar day) — the grain that matches how the data
 * was produced, since every set logged on the same day of the same plan day
 * was one workout.
 *
 * Safe to run repeatedly: migrated sessions carry `source: 'migration'` and a
 * unique index on (userId, planId, dayName, performedAt) scoped to that
 * source, so a second run inserts nothing new. Nothing is deleted — the
 * embedded history stays where it is, and progress stats read both sources
 * until it is removed deliberately.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { TrainingPlanSchema } from '../src/objects/training-plan/training-plan.schema';
import { WorkoutSessionSchema } from '../src/objects/workout-session/workout-session.schema';

interface HistoryEntry {
  date: Date;
  weight: number;
  reps: number;
}

interface PlanSet {
  history?: HistoryEntry[];
}

interface PlanExercise {
  name: string;
  muscleGroup?: string;
  sets?: PlanSet[];
}

interface PlanDay {
  dayName: string;
  exercises?: PlanExercise[];
}

interface PlanDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  days?: PlanDay[];
}

/** One rebuilt session, keyed by plan + day name + calendar date. */
interface DraftSession {
  userId: mongoose.Types.ObjectId;
  planId: mongoose.Types.ObjectId;
  planTitle: string;
  dayName: string;
  performedAt: Date;
  exercises: {
    name: string;
    muscleGroup?: string;
    sets: { reps: number; weight: number }[];
  }[];
  source: 'migration';
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Midnight UTC of the entry's calendar day. Individual set timestamps within
 * one workout differ by minutes; collapsing them to the day is what makes the
 * unique index able to recognise a re-run.
 */
function startOfUtcDay(date: Date): Date {
  return new Date(`${dayKey(date)}T00:00:00.000Z`);
}

function draftSessionsFor(plan: PlanDoc): DraftSession[] {
  const byKey = new Map<string, DraftSession>();

  for (const day of plan.days ?? []) {
    for (const exercise of day.exercises ?? []) {
      for (const set of exercise.sets ?? []) {
        for (const entry of set.history ?? []) {
          if (!entry?.date) continue;

          const performed = new Date(entry.date);
          if (Number.isNaN(performed.getTime())) continue;

          const key = `${day.dayName}|${dayKey(performed)}`;
          let session = byKey.get(key);

          if (!session) {
            session = {
              userId: plan.userId,
              planId: plan._id,
              planTitle: plan.title,
              dayName: day.dayName,
              performedAt: startOfUtcDay(performed),
              exercises: [],
              source: 'migration',
            };
            byKey.set(key, session);
          }

          let target = session.exercises.find((e) => e.name === exercise.name);
          if (!target) {
            target = {
              name: exercise.name,
              muscleGroup: exercise.muscleGroup,
              sets: [],
            };
            session.exercises.push(target);
          }

          target.sets.push({ reps: entry.reps, weight: entry.weight });
        }
      }
    }
  }

  return [...byKey.values()];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  await mongoose.connect(uri);
  console.log(
    `Connected${dryRun ? ' (dry run — nothing will be written)' : ''}`,
  );

  const TrainingPlan = mongoose.model('TrainingPlan', TrainingPlanSchema);
  const WorkoutSession = mongoose.model('WorkoutSession', WorkoutSessionSchema);

  // The unique index is what makes a re-run a no-op, so it has to exist before
  // the first insert rather than be built lazily afterwards.
  await WorkoutSession.syncIndexes();

  let plansScanned = 0;
  let drafted = 0;
  let inserted = 0;
  let skipped = 0;

  const cursor = TrainingPlan.find().lean<PlanDoc>().cursor();

  for await (const plan of cursor) {
    plansScanned += 1;
    const sessions = draftSessionsFor(plan);
    drafted += sessions.length;

    if (dryRun || sessions.length === 0) continue;

    try {
      // `ordered: false` so one duplicate does not abandon the rest of the plan.
      const result = await WorkoutSession.insertMany(sessions, {
        ordered: false,
      });
      inserted += result.length;
    } catch (error) {
      // Duplicate-key errors are the expected outcome of a re-run: count them
      // as skipped and keep going. Anything else is a real failure.
      const err = error as {
        code?: number;
        writeErrors?: { err?: { code?: number } }[];
        insertedDocs?: unknown[];
      };
      const writeErrors = err.writeErrors ?? [];
      const allDuplicates =
        err.code === 11000 ||
        (writeErrors.length > 0 &&
          writeErrors.every((w) => w.err?.code === 11000));

      if (!allDuplicates) throw error;

      inserted += err.insertedDocs?.length ?? 0;
      skipped += writeErrors.length || sessions.length;
    }
  }

  console.log(
    [
      `plans scanned:      ${plansScanned}`,
      `sessions rebuilt:   ${drafted}`,
      `sessions inserted:  ${inserted}`,
      `already present:    ${skipped}`,
    ].join('\n'),
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
  void mongoose.disconnect();
});
