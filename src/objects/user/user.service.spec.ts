import { UserService } from './user.service';
import type { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';
import { UserSchema, stripUserSecrets } from './user.schema';

const SELF = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';

interface Chain {
  select: jest.Mock<Chain, [string]>;
  exec: jest.Mock<Promise<unknown>, []>;
}

/** A chainable `find()/findById()` stand-in that records the projection. */
function chain(result: unknown): Chain {
  const q: Chain = {
    select: jest.fn<Chain, [string]>(() => q),
    exec: jest.fn<Promise<unknown>, []>().mockResolvedValue(result),
  };
  return q;
}

describe('UserService directory scoping (SEC-01)', () => {
  let userModel: {
    find: jest.Mock<Chain, []>;
    findById: jest.Mock<Chain, []>;
  };
  let trainerAccess: { isAcceptedTrainerOf: jest.Mock };
  let service: UserService;
  let lastQuery: Chain;

  beforeEach(() => {
    userModel = {
      find: jest.fn<Chain, []>(() => (lastQuery = chain([]))),
      findById: jest.fn<Chain, []>(() => (lastQuery = chain({ _id: OTHER }))),
    };
    trainerAccess = { isAcceptedTrainerOf: jest.fn().mockResolvedValue(false) };
    service = new UserService(
      userModel as never,
      trainerAccess as unknown as TrainerAccessService,
    );
  });

  const projection = (): string => lastQuery.select.mock.calls[0][0];

  it('gives a plain user only the public allowlist, no email', async () => {
    await service.findAllFor({ id: SELF, role: 'user' });
    expect(projection().split(' ').sort()).toEqual(
      ['_id', 'avatarUrl', 'fullName', 'role'].sort(),
    );
  });

  it('adds the email for a trainer, for the invite dialog', async () => {
    await service.findAllFor({ id: SELF, role: 'trainer' });
    expect(projection()).toContain('email');
    expect(projection()).not.toMatch(/token|password|googleCalendar/i);
  });

  it('gives an admin the whole profile minus the password', async () => {
    await service.findAllFor({ id: SELF, role: 'admin' });
    expect(projection()).toBe('-password');
  });

  it('returns the full profile to the user themselves', async () => {
    await service.findOneFor(SELF, { id: SELF, role: 'user' });
    expect(projection()).toBe('-password');
  });

  it('returns the full profile to a connected trainer', async () => {
    trainerAccess.isAcceptedTrainerOf.mockResolvedValue(true);
    await service.findOneFor(OTHER, { id: SELF, role: 'trainer' });
    expect(trainerAccess.isAcceptedTrainerOf).toHaveBeenCalledWith(SELF, OTHER);
    expect(projection()).toBe('-password');
  });

  it('returns only public fields to anyone else', async () => {
    await service.findOneFor(OTHER, { id: SELF, role: 'trainer' });
    expect(projection()).not.toContain('email');
    expect(projection()).toContain('fullName');
  });
});

describe('User schema secrets (SEC-01)', () => {
  it.each([
    'password',
    'resetPasswordToken',
    'resetPasswordExpires',
    'emailVerificationToken',
    'googleCalendar.accessToken',
    'googleCalendar.refreshToken',
  ])('hides %s from default queries', (path) => {
    expect(UserSchema.path(path).options.select).toBe(false);
  });

  it('strips secrets even from a document that opted them back in', () => {
    const out = stripUserSecrets({
      email: 'a@b.c',
      password: 'hash',
      resetPasswordToken: 'digest',
      emailVerificationToken: 'digest',
      googleCalendar: {
        accessToken: 'at',
        refreshToken: 'rt',
        connected: true,
      },
    });
    expect(out).toEqual({
      email: 'a@b.c',
      googleCalendar: { connected: true },
    });
  });
});
