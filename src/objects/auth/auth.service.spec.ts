import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';
import { NodemailerService } from '../../common/nodemailer/nodemailer.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthCodeService } from './auth-code.service';

/**
 * A stand-in for a Mongoose query: awaitable on its own (`await findById(id)`)
 * and chainable (`await findById(id).select('role')`), because `AuthService`
 * uses it both ways.
 */
const query = <T>(value: T) => ({
  select: jest.fn().mockResolvedValue(value),
  then: (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(value).then(resolve, reject),
});

describe('AuthService', () => {
  let service: AuthService;
  let userModel: { findOne: jest.Mock; findById: jest.Mock };
  let nodemailerService: { sendResetEmail: jest.Mock };
  let tokenBlacklistService: {
    isBlacklisted: jest.Mock;
    addToBlacklist: jest.Mock;
    getTokenExpiration: jest.Mock;
  };
  let refreshTokenService: {
    startFamily: jest.Mock;
    register: jest.Mock;
    rotate: jest.Mock;
    revokeFamily: jest.Mock;
  };
  let authCodeService: { issue: jest.Mock; redeem: jest.Mock };

  const buildUser = () => ({
    id: 'user-1',
    email: 'athlete@example.com',
    resetPasswordToken: undefined as string | undefined,
    resetPasswordExpires: undefined as Date | undefined,
    save: jest.fn().mockResolvedValue(undefined),
  });

  /** A persisted user as `findById` would hand it back. */
  const storedUser = {
    _id: { toString: () => 'user-1' },
    email: 'athlete@example.com',
    role: 'user',
    // `sanitize()` calls this, the way a real Mongoose document would
    toObject: () => ({
      _id: 'user-1',
      email: 'athlete@example.com',
      role: 'user',
      password: 'never-leaves-the-service',
    }),
  };

  const signRefresh = (payload: Record<string, unknown>) =>
    jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' });

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  });

  beforeEach(async () => {
    userModel = {
      findOne: jest.fn(),
      findById: jest.fn().mockReturnValue(query(storedUser)),
    };
    nodemailerService = {
      sendResetEmail: jest.fn().mockResolvedValue(undefined),
    };
    tokenBlacklistService = {
      isBlacklisted: jest.fn().mockResolvedValue(false),
      addToBlacklist: jest.fn().mockResolvedValue(undefined),
      getTokenExpiration: jest
        .fn()
        .mockReturnValue(new Date(Date.now() + 1000)),
    };
    refreshTokenService = {
      startFamily: jest
        .fn()
        .mockReturnValue({ familyId: 'family-1', jti: 'jti-1' }),
      register: jest.fn().mockResolvedValue(undefined),
      rotate: jest.fn().mockResolvedValue({
        status: 'rotated',
        nextJti: 'jti-2',
      }),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
    };
    authCodeService = {
      issue: jest.fn().mockResolvedValue('a'.repeat(64)),
      redeem: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken('User'), useValue: userModel },
        { provide: NodemailerService, useValue: nodemailerService },
        { provide: TokenBlacklistService, useValue: tokenBlacklistService },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        { provide: AuthCodeService, useValue: authCodeService },
      ],
    }).compile();

    service = module.get(AuthService);

    // Keep the expected error log out of the test output
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('forgotPassword', () => {
    it('resolves without sending mail when the email is unknown', async () => {
      userModel.findOne.mockResolvedValue(null);

      await expect(
        service.forgotPassword('nobody@example.com'),
      ).resolves.toBeUndefined();
      expect(nodemailerService.sendResetEmail).not.toHaveBeenCalled();
    });

    it('stores a reset token with an expiry and emails it', async () => {
      const user = buildUser();
      userModel.findOne.mockResolvedValue(user);

      await service.forgotPassword(user.email);

      expect(user.resetPasswordToken).toEqual(expect.any(String));
      expect(user.resetPasswordExpires).toBeInstanceOf(Date);
      expect(user.resetPasswordExpires!.getTime()).toBeGreaterThan(Date.now());
      expect(user.save).toHaveBeenCalled();
      expect(nodemailerService.sendResetEmail).toHaveBeenCalledWith(
        user.email,
        user.resetPasswordToken,
      );
    });

    it('issues a distinct token per request', async () => {
      const first = buildUser();
      const second = buildUser();
      userModel.findOne
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);

      await service.forgotPassword(first.email);
      await service.forgotPassword(second.email);

      expect(first.resetPasswordToken).not.toEqual(second.resetPasswordToken);
    });

    // The regression this guards: an unknown email resolves quietly, so a
    // known email whose mail delivery fails must resolve quietly too.
    // Otherwise the response status tells an attacker the account exists.
    it('swallows mail delivery failures so the response cannot be used to enumerate accounts', async () => {
      const user = buildUser();
      userModel.findOne.mockResolvedValue(user);
      nodemailerService.sendResetEmail.mockRejectedValue(
        new Error('SMTP connection refused'),
      );

      await expect(service.forgotPassword(user.email)).resolves.toBeUndefined();
      // The token is still persisted, so a retry or a resend can succeed
      expect(user.save).toHaveBeenCalled();
    });

    it('logs the delivery failure instead of discarding it', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      userModel.findOne.mockResolvedValue(buildUser());
      nodemailerService.sendResetEmail.mockRejectedValue(new Error('boom'));

      await service.forgotPassword('athlete@example.com');

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('token lifetimes', () => {
    // The regression this guards: the access token used to be signed with the
    // same '7d' as the refresh token, which made rotation pointless — a
    // captured access token outlived any revocation.
    it('signs a short access token and a long refresh token', async () => {
      const { accessToken, refreshToken } = await service.refreshToken(
        signRefresh({
          userId: 'user-1',
          email: storedUser.email,
          fid: 'family-1',
          jti: 'jti-1',
        }),
      );

      const access = jwt.decode(accessToken) as { exp: number; iat: number };
      const refresh = jwt.decode(refreshToken) as { exp: number; iat: number };

      expect(access.exp - access.iat).toBe(15 * 60);
      expect(refresh.exp - refresh.iat).toBe(7 * 24 * 60 * 60);
    });

    it('stamps the session id on both tokens so logout can revoke the family', async () => {
      const { accessToken, refreshToken } = await service.refreshToken(
        signRefresh({
          userId: 'user-1',
          email: storedUser.email,
          fid: 'family-1',
          jti: 'jti-1',
        }),
      );

      expect(jwt.decode(accessToken)).toMatchObject({ fid: 'family-1' });
      expect(jwt.decode(refreshToken)).toMatchObject({
        fid: 'family-1',
        jti: 'jti-2',
      });
    });
  });

  describe('refreshToken rotation', () => {
    const validToken = () =>
      signRefresh({
        userId: 'user-1',
        email: storedUser.email,
        fid: 'family-1',
        jti: 'jti-1',
      });

    it('rejects a token that does not verify', async () => {
      await expect(service.refreshToken('not-a-jwt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('spends the presented token so it cannot be redeemed twice', async () => {
      const token = validToken();

      await service.refreshToken(token);

      expect(tokenBlacklistService.addToBlacklist).toHaveBeenCalledWith(
        token,
        expect.any(Date),
        'user-1',
      );
    });

    it('advances the family to the next jti', async () => {
      await service.refreshToken(validToken());

      expect(refreshTokenService.rotate).toHaveBeenCalledWith(
        'family-1',
        'jti-1',
      );
      expect(refreshTokenService.register).toHaveBeenCalledWith(
        'family-1',
        'user-1',
        'jti-2',
        expect.any(Date),
      );
    });

    // The whole point of rotation: an older token in the chain means someone
    // kept a copy, and the session must end for everyone holding one.
    it('rejects a replayed token and does not issue a new pair', async () => {
      refreshTokenService.rotate.mockResolvedValue({ status: 'replayed' });

      await expect(service.refreshToken(validToken())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokenService.register).not.toHaveBeenCalled();
    });

    it('rejects a token whose family was revoked by logout', async () => {
      refreshTokenService.rotate.mockResolvedValue({ status: 'unknown' });

      await expect(service.refreshToken(validToken())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('revokes the family when an already-spent token comes back', async () => {
      tokenBlacklistService.isBlacklisted.mockResolvedValue(true);

      await expect(service.refreshToken(validToken())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(refreshTokenService.revokeFamily).toHaveBeenCalledWith('family-1');
    });

    it('rejects a token for a user that no longer exists', async () => {
      userModel.findById.mockReturnValue(query(null));

      await expect(service.refreshToken(validToken())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    // Tokens minted before rotation existed carry no fid/jti. Rejecting them
    // would log out every signed-in user the moment this deploys.
    it('honours a pre-rotation token once and upgrades it to a new family', async () => {
      const legacy = signRefresh({
        userId: 'user-1',
        email: storedUser.email,
      });

      const result = await service.refreshToken(legacy);

      expect(result.accessToken).toEqual(expect.any(String));
      expect(refreshTokenService.rotate).not.toHaveBeenCalled();
      expect(refreshTokenService.startFamily).toHaveBeenCalled();
      // and it is spent, so the same legacy token cannot be upgraded twice
      expect(tokenBlacklistService.addToBlacklist).toHaveBeenCalledWith(
        legacy,
        expect.any(Date),
        'user-1',
      );
    });
  });

  describe('exchangeOAuthCode', () => {
    it('returns a session for a valid code', async () => {
      authCodeService.redeem.mockResolvedValue({
        userId: 'user-1',
        needsProfile: true,
      });

      const result = await service.exchangeOAuthCode('a'.repeat(64));

      expect(result.needsProfile).toBe(true);
      expect(result.tokens.accessToken).toEqual(expect.any(String));
      expect(result.tokens.refreshToken).toEqual(expect.any(String));
      // the redeemed session must not carry the password through
      expect(result.user).not.toHaveProperty('password');
    });

    // Single use is enforced by the store; the service must surface the miss
    // as a rejection rather than minting a second session.
    it('rejects a code that has already been redeemed', async () => {
      authCodeService.redeem.mockResolvedValue(null);

      await expect(
        service.exchangeOAuthCode('b'.repeat(64)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a code whose user has since been deleted', async () => {
      authCodeService.redeem.mockResolvedValue({
        userId: 'user-1',
        needsProfile: false,
      });
      userModel.findById.mockReturnValue(query(null));

      await expect(
        service.exchangeOAuthCode('c'.repeat(64)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
