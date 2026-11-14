import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * What a Google sign-in carries through Google in the OAuth `state`.
 *
 * `nonce` binds the callback to the browser that started the flow (SEC-06).
 * It is also set as an HttpOnly cookie on `/auth/google`; the callback accepts
 * the code only when the two match. Without it, an attacker could finish their
 * own Google sign-in in a victim's browser (login CSRF) and have the victim
 * work inside the attacker's account.
 *
 * The Android app cannot be reached at FRONTEND_URL, so it adds
 * `platform=android` and is sent back to its own URL scheme. `challenge` is the
 * PKCE S256 challenge (RFC 7636): any Android app can claim the
 * `com.fitai.app://` scheme, so the code is redeemable only with the verifier
 * that never left the real app.
 */
export interface OAuthState {
  nonce: string;
  platform?: 'android';
  challenge?: string;
}

/** The app's own scheme; must match the intent-filter in AndroidManifest.xml. */
export const ANDROID_REDIRECT_BASE = 'com.fitai.app://oauth';

/** Cookie holding the browser's copy of the nonce. */
export const OAUTH_NONCE_COOKIE = 'fitai_oauth_nonce';

/** base64url of 32 bytes / of a SHA-256 digest: always 43 chars, no padding. */
const TOKEN_43_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A fresh nonce for one sign-in attempt. */
export function newOAuthNonce(): string {
  return randomBytes(32).toString('base64url');
}

export function encodeOAuthState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

/**
 * Read the state back, or `null` for anything malformed. A null state fails
 * the nonce check, so a callback without a well-formed state never signs in.
 */
export function decodeOAuthState(raw: unknown): OAuthState | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<OAuthState> | null;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.nonce !== 'string' ||
      !TOKEN_43_PATTERN.test(parsed.nonce)
    ) {
      return null;
    }

    if (parsed.platform === undefined) {
      return { nonce: parsed.nonce };
    }
    if (
      parsed.platform === 'android' &&
      typeof parsed.challenge === 'string' &&
      TOKEN_43_PATTERN.test(parsed.challenge)
    ) {
      return {
        nonce: parsed.nonce,
        platform: 'android',
        challenge: parsed.challenge,
      };
    }
  } catch {
    // Not base64 JSON: no usable state.
  }

  return null;
}

/** True when the state's nonce is the one this browser was given. */
export function nonceMatches(
  state: OAuthState | null,
  cookieNonce: unknown,
): boolean {
  if (!state || typeof cookieNonce !== 'string') return false;
  const a = Buffer.from(state.nonce);
  const b = Buffer.from(cookieNonce);
  return a.length === b.length && timingSafeEqual(a, b);
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
