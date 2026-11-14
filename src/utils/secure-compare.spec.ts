import { hashToken, safeEqual } from './secure-compare';

describe('secure-compare', () => {
  it('hashes a token to a stable SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares equal strings as equal', () => {
    expect(safeEqual('Bearer s3cret', 'Bearer s3cret')).toBe(true);
  });

  it.each([
    ['a different value', 'Bearer wrong'],
    ['a prefix', 'Bearer s3cre'],
    ['nothing', undefined],
  ])('rejects %s', (_label, candidate) => {
    expect(safeEqual(candidate, 'Bearer s3cret')).toBe(false);
  });
});
