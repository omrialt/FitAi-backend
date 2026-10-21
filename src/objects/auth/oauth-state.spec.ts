import {
  decodeOAuthState,
  encodeOAuthState,
  pkceChallenge,
  verifierMatches,
} from './oauth-state';

// RFC 7636 Appendix B test vector.
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('oauth-state', () => {
  describe('PKCE', () => {
    it('derives the RFC 7636 S256 challenge', () => {
      expect(pkceChallenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
    });

    it('accepts the matching verifier and rejects any other', () => {
      expect(verifierMatches(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
      expect(verifierMatches(RFC_VERIFIER + 'x', RFC_CHALLENGE)).toBe(false);
      expect(verifierMatches(RFC_VERIFIER, 'short')).toBe(false);
    });
  });

  describe('state', () => {
    it('round-trips an Android state', () => {
      const state = { platform: 'android' as const, challenge: RFC_CHALLENGE };
      expect(decodeOAuthState(encodeOAuthState(state))).toEqual(state);
    });

    // Anything else takes the web flow, the behaviour before state existed.
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['not base64 JSON', '%%%not-state%%%'],
      [
        'another platform',
        Buffer.from(
          JSON.stringify({ platform: 'ios', challenge: RFC_CHALLENGE }),
        ).toString('base64url'),
      ],
      [
        'a malformed challenge',
        Buffer.from(
          JSON.stringify({ platform: 'android', challenge: 'abc' }),
        ).toString('base64url'),
      ],
      ['an array', ['a', 'b']],
    ])('treats %s as no state', (_label, raw) => {
      expect(decodeOAuthState(raw)).toBeNull();
    });
  });
});
