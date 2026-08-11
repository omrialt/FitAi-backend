/**
 * Grandfather existing accounts past the new email-verification requirement.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-email-verified.ts [--dry-run]
 *
 * Login now rejects accounts with `emailVerified: false`. Every account that
 * predates the verification flow has that flag false — not because anyone
 * failed to verify, but because there was nothing to verify with. Deploying
 * the check without this script locks out every existing user, including the
 * demo accounts.
 *
 * So: accounts created before the cutoff are marked verified. Accounts created
 * after it went through the real flow and are left exactly as they are.
 *
 * The cutoff defaults to the moment the script runs, which is the right answer
 * when it runs as part of the deploy. Override it with --before=ISO_DATE to
 * re-run later without sweeping up signups that legitimately have not verified.
 *
 * Safe to run repeatedly: the update only touches documents that are still
 * unverified and older than the cutoff, so a second run reports 0 modified.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { UserSchema } from '../src/objects/user/user.schema';

function parseArgs(): { dryRun: boolean; before: Date } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const beforeArg = args.find((a) => a.startsWith('--before='));
  if (!beforeArg) {
    return { dryRun, before: new Date() };
  }

  const before = new Date(beforeArg.split('=')[1]);
  if (Number.isNaN(before.getTime())) {
    throw new Error(`--before is not a valid date: ${beforeArg}`);
  }

  return { dryRun, before };
}

async function main(): Promise<void> {
  const { dryRun, before } = parseArgs();

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  await mongoose.connect(uri);
  const User = mongoose.model('User', UserSchema);

  // `createdAt` is stamped by the schema's timestamps. A user without one
  // predates that and is therefore certainly old enough to grandfather, hence
  // the $exists branch.
  const filter = {
    emailVerified: { $ne: true },
    $or: [{ createdAt: { $lt: before } }, { createdAt: { $exists: false } }],
  };

  const candidates = await User.countDocuments(filter);
  const total = await User.countDocuments({});

  if (dryRun) {
    const sample = await User.find(filter)
      .select('email createdAt')
      .limit(10)
      .lean();

    console.log(
      [
        'DRY RUN — nothing written',
        `cutoff:             ${before.toISOString()}`,
        `users total:        ${total}`,
        `would be verified:  ${candidates}`,
        sample.length ? '\nfirst few:' : '',
        ...sample.map(
          (u: { email?: string; createdAt?: Date }) =>
            `  ${u.email ?? '(no email)'}  ${u.createdAt?.toISOString() ?? '(no createdAt)'}`,
        ),
      ]
        .filter(Boolean)
        .join('\n'),
    );

    await mongoose.disconnect();
    return;
  }

  const result = await User.updateMany(filter, {
    $set: { emailVerified: true },
  });

  console.log(
    [
      `cutoff:            ${before.toISOString()}`,
      `users total:       ${total}`,
      `matched:           ${result.matchedCount}`,
      `marked verified:   ${result.modifiedCount}`,
    ].join('\n'),
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
  void mongoose.disconnect();
});
