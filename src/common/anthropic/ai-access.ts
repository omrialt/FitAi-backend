import { ForbiddenException } from '@nestjs/common';

/**
 * Who may spend a model call.
 *
 * Every AI feature turns on for every signed-in user the moment a key is
 * configured, and nothing yet caps what one account can spend. Until a
 * per-user quota exists, the features are open to the owner's account only.
 *
 * The list is deliberately code and not configuration: an unset or mistyped
 * environment variable must not be able to open this to everyone. Anything
 * that is not on the list — including a missing email — is refused.
 */
export const AI_ALLOWED_EMAILS: readonly string[] = ['omrialt@gmail.com'];

export function isAiAllowed(email?: string | null): boolean {
  if (!email) return false;
  return AI_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

/** For routes that spend a call: 403, before anything else is looked at. */
export function assertAiAllowed(email?: string | null): void {
  if (!isAiAllowed(email)) {
    throw new ForbiddenException(
      'AI features are not available for this account',
    );
  }
}
