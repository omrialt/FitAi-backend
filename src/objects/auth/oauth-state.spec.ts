import {
  decodeOAuthState,
  encodeOAuthState,
  newOAuthNonce,
  nonceMatches,
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
    const NONCE = newOAuthNonce();
    const b64 = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString('base64url');

    it('mints a 43-character base64url nonce, different every time', () => {
      expect(NONCE).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(newOAuthNonce()).not.toBe(NONCE);
    });

    it('round-trips a web state', () => {
      const state = { nonce: NONCE };
      expect(decodeOAuthState(encodeOAuthState(state))).toEqual(state);
    });

    it('round-trips an Android state', () => {
      const state = {
        nonce: NONCE,
        platform: 'android' as const,
        challenge: RFC_CHALLENGE,
      };
      expect(decodeOAuthState(encodeOAuthState(state))).toEqual(state);
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['not base64 JSON', '%%%not-state%%%'],
      [
        'without a nonce',
        b64({ platform: 'android', challenge: RFC_CHALLENGE }),
      ],
      ['a malformed nonce', b64({ nonce: 'short' })],
      ['another platform', b64({ nonce: NONCE, platform: 'ios' })],
      [
        'a malformed challenge',
        b64({ nonce: NONCE, platform: 'android', challenge: 'abc' }),
      ],
      ['an array', ['a', 'b']],
    ])('rejects %s', (_label, raw) => {
      expect(decodeOAuthState(raw)).toBeNull();
    });
  });

  // SEC-06: the callback signs in only the browser that started the flow.
  describe('nonceMatches', () => {
    const NONCE = newOAuthNonce();

    it('accepts the cookie that was set with the state', () => {
      expect(nonceMatches({ nonce: NONCE }, NONCE)).toBe(true);
    });

    it.each([
      ['a different nonce', newOAuthNonce()],
      ['no cookie', undefined],
      ['a non-string cookie', ['x']],
    ])('rejects %s', (_label, cookie) => {
      expect(nonceMatches({ nonce: NONCE }, cookie)).toBe(false);
    });

    it('rejects a missing state', () => {
      expect(nonceMatches(null, NONCE)).toBe(false);
    });
  });
});
