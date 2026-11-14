import { createHash, timingSafeEqual } from 'crypto';

/**
 * SHA-256 hex digest of a bearer token (security: SEC-05).
 *
 * Reset and verification tokens are credentials, so the database keeps only
 * their digest: a leaked collection, or a response that leaks a field, then
 * yields nothing that can be redeemed. The mailed link keeps the raw value.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time string equality (security: SEC-11).
 *
 * `===` returns as soon as a byte differs, which leaks how much of a secret a
 * guess got right. Both sides are hashed first so inputs of different lengths
 * compare in constant time too, rather than short-circuiting on length.
 */
export function safeEqual(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
