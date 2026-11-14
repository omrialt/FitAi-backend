import { AuthCodeService } from './auth-code.service';

/**
 * SEC-02: calendar connect states and Google sign-in codes share one store, so
 * the one guarantee that matters is that neither can be redeemed as the other.
 */
describe('AuthCodeService purposes', () => {
  type Doc = Record<string, unknown>;
  interface Filter {
    codeHash: string;
    purpose: string | { $in: Array<string | null> };
  }
  let docs: Doc[];
  let service: AuthCodeService;

  const matches = (doc: Doc, filter: Filter): boolean => {
    if (doc.codeHash !== filter.codeHash) return false;
    if (!((doc.expiresAt as Date) > new Date())) return false;
    const purpose = (doc.purpose as string | undefined) ?? null;
    return typeof filter.purpose === 'string'
      ? purpose === filter.purpose
      : filter.purpose.$in.includes(purpose);
  };

  beforeEach(() => {
    docs = [];
    const model = {
      create: jest.fn((doc: Doc) => {
        docs.push({ purpose: 'login', ...doc });
        return Promise.resolve();
      }),
      findOneAndDelete: jest.fn((filter: Filter) => ({
        exec: jest.fn(() => {
          const i = docs.findIndex((d) => matches(d, filter));
          return Promise.resolve(i === -1 ? null : docs.splice(i, 1)[0]);
        }),
      })),
    };
    service = new AuthCodeService(model as never);
  });

  it('redeems a calendar state once, for the user it was minted for', async () => {
    const state = await service.issueCalendarState('user-1');
    expect(await service.redeemCalendarState(state)).toBe('user-1');
    expect(await service.redeemCalendarState(state)).toBeNull();
  });

  it('refuses to sign anyone in with a calendar state', async () => {
    const state = await service.issueCalendarState('user-1');
    expect(await service.redeem(state)).toBeNull();
  });

  it('refuses a sign-in code as a calendar state', async () => {
    const code = await service.issue('user-1', false);
    expect(await service.redeemCalendarState(code)).toBeNull();
  });

  it('rejects a state that was never issued, or is not a string', async () => {
    expect(await service.redeemCalendarState('f'.repeat(64))).toBeNull();
    expect(await service.redeemCalendarState(['x'])).toBeNull();
  });
});
