/**
 * One-off cleanup after the SEC-01 / SEC-05 fixes are deployed.
 *
 *   npm run security:cleanup:dry                    # report only
 *   npm run security:cleanup                        # clear pending tokens
 *   npm run security:cleanup -- --disconnect-calendar
 *
 * Before the fix, `GET /users` returned `resetPasswordToken` and the Google
 * Calendar OAuth tokens of every account to every signed-in user. Whatever was
 * issued before the deploy has to be treated as exposed:
 *
 *   - Pending password-reset tokens are cleared. They were stored raw; the new
 *     code stores and looks up a SHA-256 digest, so these could never be
 *     redeemed again anyway — clearing them just removes the plaintext.
 *   - Pending email-verification tokens are left alone only if they are already
 *     a digest written by the new code; raw ones are cleared, and the user can
 *     ask for a fresh link from the login screen.
 *   - With --disconnect-calendar, every Google Calendar connection is dropped
 *     (tokens deleted, `connected: false`). Users reconnect from the schedule
 *     page. Revoke the old grants in Google Cloud as well if exposure is
 *     confirmed.
 *
 * Safe to run repeatedly: a second run finds nothing to do.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { UserSchema } from '../src/objects/user/user.schema';

/**
 * A digest written by `hashToken` is 64 hex chars and so is a legacy raw
 * token, so they are told apart by when they were written (`--before`,
 * default now), not by their shape. Run this right after the deploy.
 */
function parseArgs(): {
  dryRun: boolean;
  disconnectCalendar: boolean;
  before: Date;
} {
  const args = process.argv.slice(2);
  const beforeArg = args.find((a) => a.startsWith('--before='));
  const before = beforeArg ? new Date(beforeArg.split('=')[1]) : new Date();
  if (Number.isNaN(before.getTime())) {
    throw new Error(`--before is not a valid date: ${beforeArg}`);
  }
  return {
    dryRun: args.includes('--dry-run'),
    disconnectCalendar: args.includes('--disconnect-calendar'),
    before,
  };
}

async function main(): Promise<void> {
  const { dryRun, disconnectCalendar, before } = parseArgs();

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  await mongoose.connect(uri);
  const User = mongoose.model('User', UserSchema);

  // Every reset token issued before the cutoff is a raw, possibly-leaked one.
  // Reset tokens live one hour, so "before the deploy" is all of them.
  const resetFilter = { resetPasswordToken: { $exists: true, $ne: null } };

  // Verification tokens live 24h. Those written before the cutoff are raw.
  const verifyFilter = {
    emailVerificationToken: { $exists: true, $ne: null },
    updatedAt: { $lt: before },
  };

  const calendarFilter = {
    $or: [
      { 'googleCalendar.accessToken': { $exists: true } },
      { 'googleCalendar.refreshToken': { $exists: true } },
    ],
  };

  const [resets, verifications, calendars] = await Promise.all([
    User.countDocuments(resetFilter),
    User.countDocuments(verifyFilter),
    User.countDocuments(calendarFilter),
  ]);

  console.log(`Cutoff: ${before.toISOString()}`);
  console.log(`Pending reset tokens:          ${resets}`);
  console.log(`Raw verification tokens:       ${verifications}`);
  console.log(
    `Google Calendar connections:   ${calendars}` +
      (disconnectCalendar
        ? ' (will disconnect)'
        : ' (kept; pass --disconnect-calendar)'),
  );

  if (dryRun) {
    console.log('\nDry run: nothing written.');
    await mongoose.disconnect();
    return;
  }

  const r1 = await User.updateMany(resetFilter, {
    $unset: { resetPasswordToken: '', resetPasswordExpires: '' },
  });
  const r2 = await User.updateMany(verifyFilter, {
    $unset: { emailVerificationToken: '', emailVerificationExpires: '' },
  });
  console.log(`\nCleared reset tokens:        ${r1.modifiedCount}`);
  console.log(`Cleared verification tokens: ${r2.modifiedCount}`);

  if (disconnectCalendar) {
    const r3 = await User.updateMany(calendarFilter, {
      $unset: {
        'googleCalendar.accessToken': '',
        'googleCalendar.refreshToken': '',
        'googleCalendar.expiryDate': '',
      },
      $set: { 'googleCalendar.connected': false },
    });
    console.log(`Disconnected calendars:      ${r3.modifiedCount}`);
  }

  await mongoose.disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
