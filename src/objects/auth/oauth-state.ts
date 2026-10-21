import { createHash, timingSafeEqual } from 'crypto';

/**
 * Where a Google sign-in started, carried through Google in the OAuth `state`.
 *
 * The web flow sends no state and is redirected to FRONTEND_URL exactly as
 * before. The Android app cannot be reached at FRONTEND_URL — the redirect
 * would open the website in the browser and leave the user there — so it
 * starts with `platform=android` and is sent back to its own URL scheme.
 *
 * `challenge` is the PKCE S256 challenge (RFC 7636). Any Android app can claim
 * the `com.fitai.app://` scheme and receive the redirect, so the code it
 * carries is only redeemable together with the verifier that never left the
 * real app.
 */
export interface OAuthState {
  platform: 'android';
  challenge: string;
}

/** The app's own scheme; must match the intent-filter in AndroidManifest.xml. */
export const ANDROID_REDIRECT_BASE = 'com.fitai.app://oauth';

/** base64url of a SHA-256 digest: always 43 characters, no padding. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function encodeOAuthState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

/**
 * Read the state back, or `null` for anything that is not a well-formed
 * Android state — which then takes the web flow, the behaviour before state
 * existed.
 */
export function decodeOAuthState(raw: unknown): OAuthState | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as OAuthState).platform === 'android' &&
      typeof (parsed as OAuthState).challenge === 'string' &&
      CHALLENGE_PATTERN.test((parsed as OAuthState).challenge)
    ) {
      return {
        platform: 'android',
        challenge: (parsed as OAuthState).challenge,
      };
    }
  } catch {
    // Not base64 JSON: treat as no state.
  }

  return null;
}

/** S256: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function verifierMatches(verifier: string, challenge: string): boolean {
  const actual = Buffer.from(pkceChallenge(verifier));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
