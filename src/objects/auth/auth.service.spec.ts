import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  Logger,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { NodemailerService } from '../../common/nodemailer/nodemailer.service';
import { TokenBlacklistService } from './token-blacklist.service';

describe('AuthService', () => {
  let service: AuthService;
  let userModel: { findOne: jest.Mock; findById: jest.Mock };
  let nodemailerService: { sendResetEmail: jest.Mock };

  const buildUser = () => ({
    id: 'user-1',
    email: 'athlete@example.com',
    resetPasswordToken: undefined as string | undefined,
    resetPasswordExpires: undefined as Date | undefined,
    save: jest.fn().mockResolvedValue(undefined),
  });

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  });

  beforeEach(async () => {
    userModel = {
      findOne: jest.fn(),
      // `generateTokens` reads the role through a chained select
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({ role: 'user' }),
      }),
    };
    nodemailerService = {
      sendResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken('User'), useValue: userModel },
        { provide: NodemailerService, useValue: nodemailerService },
        { provide: TokenBlacklistService, useValue: {} },
      ],
    }).compile();

    service = module.get(AuthService);

    // Keep the expected error log out of the test output
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('login email verification gate', () => {
    /**
     * `login` reads the user through `.select('+password')`, so the mock has
     * to answer that chain rather than resolve directly.
     */
    const withUser = (user: unknown) => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(user),
      });
    };

    const account = async (emailVerified: boolean) => ({
      _id: { toString: () => 'user-1' },
      email: 'athlete@example.com',
      password: await bcrypt.hash('correct-horse', 10),
      emailVerified,
      toObject: () => ({ _id: 'user-1', email: 'athlete@example.com' }),
    });

    it('rejects an unverified account with a machine-readable code', async () => {
      withUser(await account(false));

      const attempt = service.login({
        email: 'athlete@example.com',
        password: 'correct-horse',
      });

      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
      await expect(attempt).rejects.toMatchObject({
        response: { code: 'EMAIL_NOT_VERIFIED' },
      });
    });

    // The check must sit behind the password, or the response tells an
    // attacker which addresses have accounts.
    it('answers a wrong password the same way whether or not the account is verified', async () => {
      withUser(await account(false));

      await expect(
        service.login({ email: 'athlete@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lets a verified account through', async () => {
      withUser(await account(true));

      await expect(
        service.login({
          email: 'athlete@example.com',
          password: 'correct-horse',
        }),
      ).resolves.toMatchObject({
        tokens: {
          accessToken: expect.any(String) as string,
          refreshToken: expect.any(String) as string,
        },
      });
    });
  });

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
});
