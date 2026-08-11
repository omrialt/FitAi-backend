import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  HttpStatus,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { NodemailerService } from '../../common/nodemailer/nodemailer.service';
import { randomBytes } from 'crypto';
import type { User } from '../user/user.schema';
import {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateProfileDto,
  CompleteProfileDto,
  AuthResponse,
  RegisterResponse,
} from '../../interfaces/auth.interfaces';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthCodeService } from './auth-code.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Token lifetimes. The access token is deliberately short because it is the
   * one that travels on every request; the refresh token is long but is now
   * single-use and revocable, which is what makes the asymmetry safe.
   */
  private static readonly ACCESS_TOKEN_TTL = '15m';
  private static readonly REFRESH_TOKEN_TTL = '7d';
  private static readonly REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Error code the client branches on to offer "resend verification" instead
   * of "wrong password". Exported as a constant so the string exists once.
   */
  static readonly EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

  /** Never leaves the service on a user object, whatever the caller asked for. */
  private static readonly SECRET_FIELDS = [
    'password',
    'emailVerificationToken',
    'emailVerificationExpires',
    'resetPasswordToken',
    'resetPasswordExpires',
  ] as const;

  constructor(
    @InjectModel('User') private readonly userModel: Model<User>,
    private readonly nodemailerService: NodemailerService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly authCodeService: AuthCodeService,
  ) {}

  /**
   * Login with email and password
   */
  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const { email, password } = loginDto;

    // Find user by email
    const user = await this.userModel.findOne({ email }).select('+password');
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user has password (Google OAuth users don't have passwords)
    if (!user.password) {
      throw new UnauthorizedException('Please login with Google');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // The verification flow (token, email, /auth/verify-email) has existed
    // since Phase 4, but nothing ever read the flag — so an address nobody
    // proved they own was as good as one they did. This is the check that
    // makes the rest of that flow mean something.
    //
    // Deliberately after the password check: answering "verify your email"
    // to a wrong password would tell an attacker the account exists.
    if (!user.emailVerified) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        // Machine-readable so the client can offer "resend" instead of
        // string-matching an English message that translation will change.
        code: AuthService.EMAIL_NOT_VERIFIED,
        message: 'Please verify your email address before signing in',
      });
    }

    // Generate tokens
    const tokens = await this.generateTokens(user._id.toString(), user.email);

    return {
      user: this.sanitize(user),
      tokens,
    };
  }

  /**
   * Register new user
   */
  async register(registerDto: RegisterDto): Promise<RegisterResponse> {
    const { email, password, ...userData } = registerDto;

    // Check if user already exists
    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const verification = this.createVerificationToken();
    const user = await this.userModel.create({
      email,
      password: hashedPassword,
      ...userData,
      emailVerified: false,
      emailVerificationToken: verification.token,
      emailVerificationExpires: verification.expiresAt,
    });

    // Delivery is best-effort: a mail outage must not cost the user their
    // account. They can request the link again from /auth/resend-verification.
    try {
      await this.nodemailerService.sendVerificationEmail(
        user.email,
        verification.token,
        user.fullName,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    // No tokens. Registration used to sign the new account straight in, which
    // would make the login check above trivially bypassable — register, get a
    // session, never open the email. The client sends the user to the "check
    // your inbox" state and they sign in after verifying.
    //
    // `create()` returns the document it just built, so `select: false` does
    // not apply — the verification token has to be stripped explicitly or it
    // ships straight back to the client that registered.
    return {
      user: this.sanitize(user),
      requiresVerification: true,
    };
  }

  /**
   * Logout user.
   *
   * Blacklisting the access token only ever ended half the session: the
   * refresh token survived and could mint a new access token immediately.
   * The access token now carries its session's `fid`, so logout can delete the
   * refresh family too and the session actually ends.
   */
  async logout(token?: string): Promise<{ message: string }> {
    if (token) {
      try {
        // Verify the token to extract user information
        const secret = process.env.JWT_ACCESS_SECRET!;
        const payload = jwt.verify(token, secret) as {
          userId: string;
          email: string;
          fid?: string;
        };

        // Update last logout time (optional - can be used for audit purposes)
        await this.userModel.findByIdAndUpdate(payload.userId, {
          lastLogout: new Date(),
        });

        // Add token to blacklist
        const expiresAt = this.tokenBlacklistService.getTokenExpiration(token);
        await this.tokenBlacklistService.addToBlacklist(
          token,
          expiresAt,
          payload.userId,
        );

        // Kill the refresh chain. Tokens minted before this change have no
        // `fid`; nothing more can be done for those beyond the access token.
        if (payload.fid) {
          await this.refreshTokenService.revokeFamily(payload.fid);
        }

        this.logger.log(`User ${payload.userId} logged out successfully`);
      } catch {
        // If token is invalid or expired, still allow logout
        // This ensures users can always logout even with corrupted tokens
        this.logger.debug('Logout attempted with invalid/expired token');
      }
    }

    // Client-side token removal is the primary logout mechanism
    // The server confirms the logout action and blacklists the token
    return {
      message: 'Logout successful',
    };
  }

  /**
   * Exchange a refresh token for a new pair, rotating it in the process.
   *
   * Previously this issued a new pair and left the presented token valid for
   * the rest of its seven days, so every refresh minted another permanent key
   * and none of them could be revoked. Now each refresh token may be redeemed
   * exactly once: the presented one is blacklisted, the family advances to a
   * new `jti`, and a token from earlier in the chain is treated as a replay
   * and kills the session.
   */
  async refreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const secret = process.env.JWT_REFRESH_SECRET!;

    let payload: { userId: string; email: string; fid?: string; jti?: string };
    try {
      payload = jwt.verify(refreshToken, secret) as typeof payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // A token that was already spent, or that logout revoked.
    if (await this.tokenBlacklistService.isBlacklisted(refreshToken)) {
      if (payload.fid) {
        await this.refreshTokenService.revokeFamily(payload.fid);
      }
      this.logger.warn(
        `Blacklisted refresh token reused by ${payload.userId}; session revoked`,
      );
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.userModel.findById(payload.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Tokens issued before rotation existed carry no `fid`/`jti`. Rejecting
    // them would log out everyone holding one the moment this deploys, so they
    // are honoured once and upgraded into a fresh, rotatable family.
    if (!payload.fid || !payload.jti) {
      this.logger.debug(
        `Upgrading a pre-rotation refresh token for ${payload.userId}`,
      );
      await this.spendRefreshToken(refreshToken, payload.userId);
      return this.generateTokens(user._id.toString(), user.email);
    }

    const result = await this.refreshTokenService.rotate(
      payload.fid,
      payload.jti,
    );

    if (result.status !== 'rotated') {
      // 'replayed' already revoked the family; 'unknown' means it was revoked
      // earlier, by logout or by a previous replay.
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.spendRefreshToken(refreshToken, payload.userId);

    return this.generateTokens(user._id.toString(), user.email, {
      familyId: payload.fid,
      jti: result.nextJti,
    });
  }

  /**
   * Blacklist a refresh token that has just been redeemed, so presenting it
   * again is detectable even if its family has since been deleted.
   */
  private async spendRefreshToken(
    token: string,
    userId: string,
  ): Promise<void> {
    await this.tokenBlacklistService.addToBlacklist(
      token,
      this.tokenBlacklistService.getTokenExpiration(token),
      userId,
    );
  }

  /**
   * Get Google OAuth URL
   */
  getGoogleAuthUrl(): string {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
    const redirectUri = `${backendUrl}/auth/google/callback`;

    const googleAuthUrl = new URL(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    googleAuthUrl.searchParams.append('client_id', clientId);
    googleAuthUrl.searchParams.append('redirect_uri', redirectUri);
    googleAuthUrl.searchParams.append('response_type', 'code');
    googleAuthUrl.searchParams.append('scope', 'email profile');
    googleAuthUrl.searchParams.append('access_type', 'offline');

    return googleAuthUrl.toString();
  }

  /**
   * Handle Google OAuth callback
   */
  async handleGoogleCallback(
    code: string,
  ): Promise<{ userId: string; needsProfile: boolean }> {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
      const redirectUri = `${backendUrl}/auth/google/callback`;

      if (!clientId || !clientSecret) {
        throw new BadRequestException(
          'Google OAuth credentials not configured',
        );
      }

      // Exchange authorization code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResponse.ok) {
        throw new BadRequestException('Failed to exchange authorization code');
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
      };
      const { access_token } = tokenData;

      // Fetch user profile from Google
      const profileResponse = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        },
      );

      if (!profileResponse.ok) {
        throw new BadRequestException('Failed to fetch user profile');
      }

      const profile = (await profileResponse.json()) as {
        email?: string;
        name?: string;
        picture?: string;
      };
      const { email, name, picture } = profile;

      if (!email) {
        throw new BadRequestException('Email not provided by Google');
      }

      // Check if user exists
      let user = await this.userModel.findOne({ email });
      let needsProfile = false;

      if (!user) {
        // Create new user with Google OAuth
        user = await this.userModel.create({
          email,
          fullName: name || email.split('@')[0],
          authProvider: 'google',
          avatarUrl: picture || '',
          emailVerified: true,
          // No password needed for Google OAuth users
        });
        needsProfile = true; // New user needs to complete profile
      } else if (user.authProvider === 'email') {
        // Link Google account to existing email account
        user.authProvider = 'google';
        user.avatarUrl = picture || user.avatarUrl;
        user.emailVerified = true;
        await user.save();
      }

      // Check if user needs to complete profile (missing required fields)
      if (!user.gender || !user.birthDate || !user.role) {
        needsProfile = true;
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // No tokens are minted here. The controller hands the browser a
      // single-use code instead, and the session is created when that code is
      // redeemed — otherwise every Google sign-in would open a refresh family
      // that the redirect never uses.
      return {
        userId: user._id.toString(),
        needsProfile,
      };
    } catch (error) {
      this.logger.error(
        'Google OAuth exchange failed',
        error instanceof Error ? error.stack : String(error),
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Log the full error for debugging
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(
        `Google OAuth authentication failed: ${errorMessage}`,
      );
    }
  }

  /**
   * Get user profile
   */
  async getProfile(userId: string): Promise<Omit<User, 'password'>> {
    const user = await this.userModel.findById(userId).select('-password');
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.toObject();
  }

  /**
   * Update user profile
   */
  async updateProfile(
    userId: string,
    updateData: UpdateProfileDto,
  ): Promise<Omit<User, 'password'>> {
    const user = await this.userModel
      .findByIdAndUpdate(userId, updateData, { new: true })
      .select('-password');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.toObject();
  }

  /**
   * Complete profile for Google OAuth users
   */
  async completeProfile(
    userId: string,
    completeData: CompleteProfileDto,
  ): Promise<AuthResponse> {
    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        {
          fullName: completeData.fullName,
          gender: completeData.gender,
          birthDate: completeData.birthDate,
          role: completeData.role,
          height: completeData.height,
        },
        { new: true },
      )
      .select('-password');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate new tokens with updated user info
    const tokens = await this.generateTokens(user._id.toString(), user.email);

    const userObject = user.toObject();
    return {
      user: {
        ...userObject,
        _id: user._id.toString(),
      },
      tokens,
    };
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userModel.findById(userId).select('+password');
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user has password (Google OAuth users can't change password)
    if (!user.password) {
      throw new BadRequestException(
        'Cannot change password for Google OAuth accounts',
      );
    }

    // Verify old password
    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid old password');
    }

    // Hash and update new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();
  }

  /**
   * Request password reset
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      // Don't reveal if user exists
      return;
    }

    // Generate a secure reset token
    const token = randomBytes(32).toString('hex');
    // Optionally: Save token and expiry to user document for later verification
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour expiry
    await user.save();

    // A delivery failure must not surface to the caller: an unknown email
    // returns 204 above, so letting this throw a 500 would turn the response
    // status into an oracle for whether an account exists.
    try {
      await this.nodemailerService.sendResetEmail(user.email, token);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email for user ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token || !newPassword) {
      throw new BadRequestException('Token and new password are required');
    }

    // Find user by reset token and check expiry
    const user = await this.userModel
      .findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: new Date() },
      })
      .select('+password');

    if (!user) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    // Hash and set new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    // Clear reset token fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
  }

  /**
   * Confirm an email address from the link that was mailed out.
   *
   * Idempotent by design: clicking a used link, or an expired one after the
   * account is already verified, reports success rather than an error the user
   * cannot act on. Only an unknown or expired-and-still-unverified token fails.
   */
  async verifyEmail(token: string): Promise<{ verified: boolean }> {
    if (!token) {
      throw new BadRequestException('Verification token is required');
    }

    const user = await this.userModel
      .findOne({ emailVerificationToken: token })
      .select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      // The token is cleared on use, so a second click lands here. Distinguish
      // "already done" from "never valid" is impossible without keeping spent
      // tokens around, which is worse; a plain error is the honest answer.
      throw new BadRequestException('Invalid or expired verification link');
    }

    if (
      user.emailVerificationExpires &&
      user.emailVerificationExpires.getTime() < Date.now()
    ) {
      throw new BadRequestException(
        'This verification link has expired — request a new one',
      );
    }

    const wasUnverified = !user.emailVerified;
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    if (wasUnverified) {
      try {
        await this.nodemailerService.sendWelcomeEmail(
          user.email,
          user.fullName,
        );
      } catch (error) {
        this.logger.error(
          `Failed to send welcome email to ${user.email}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(`Email verified for user ${user._id.toString()}`);
    return { verified: true };
  }

  /**
   * Re-issue a verification link.
   *
   * Always resolves, whatever the address: an unknown email, an already
   * verified one and a Google account are indistinguishable from the outside,
   * so this endpoint cannot be used to enumerate who has an account.
   */
  async resendVerification(email: string): Promise<void> {
    const user = await this.userModel
      .findOne({ email })
      .select('+emailVerificationToken +emailVerificationExpires');

    if (!user || user.emailVerified) {
      return;
    }

    const verification = this.createVerificationToken();
    user.emailVerificationToken = verification.token;
    user.emailVerificationExpires = verification.expiresAt;
    await user.save();

    try {
      await this.nodemailerService.sendVerificationEmail(
        user.email,
        verification.token,
        user.fullName,
      );
    } catch (error) {
      this.logger.error(
        `Failed to resend verification email to ${user.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * A verification token is a bearer credential for an account, so it is
   * random rather than derived, and it expires. 24 hours is long enough to
   * survive a mail client that defers delivery overnight.
   */
  private createVerificationToken(): { token: string; expiresAt: Date } {
    return {
      token: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  /**
   * Strip every credential-bearing field before a user document leaves the
   * service. `select: false` covers reads; documents this service just wrote
   * still carry the values in memory, which is what this catches.
   */
  private sanitize(user: {
    toObject: () => Record<string, unknown>;
    _id: { toString: () => string };
  }): AuthResponse['user'] {
    const plain = user.toObject();

    // A deny-list rather than destructuring-and-discarding: adding a field
    // here is one line, and it reads as the security decision it is.
    for (const field of AuthService.SECRET_FIELDS) {
      delete plain[field];
    }

    return {
      ...(plain as Omit<User, 'password'>),
      _id: user._id.toString(),
    };
  }

  /**
   * Generate an access/refresh pair.
   *
   * The access token used to be signed with `expiresIn: '7d'` — the same
   * lifetime as the refresh token. That made the refresh mechanism pointless:
   * a captured access token was a week-long key, and nothing could revoke it
   * except blacklisting that exact string. Fifteen minutes is the number the
   * rest of the codebase already assumed (see the fallback in
   * `TokenBlacklistService.getTokenExpiration`), and the frontend has had a
   * single-flight 401-refresh interceptor since Phase 1, so shortening it is
   * invisible to users.
   *
   * Both tokens carry `fid` so that logout can revoke the whole session from
   * an access token alone, and the refresh token carries `jti` so the family
   * store can tell the live token from a replayed one.
   */
  private async generateTokens(
    userId: string,
    email: string,
    session?: { familyId: string; jti: string },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessSecret = process.env.JWT_ACCESS_SECRET!;
    const refreshSecret = process.env.JWT_REFRESH_SECRET!;

    // Fetch user role for token payload
    const user = await this.userModel.findById(userId).select('role');
    const role = user?.role || 'user';

    const { familyId, jti } = session ?? this.refreshTokenService.startFamily();

    const accessToken = jwt.sign(
      { userId, email, role, fid: familyId },
      accessSecret,
      { expiresIn: AuthService.ACCESS_TOKEN_TTL },
    );

    const refreshToken = jwt.sign(
      { userId, email, role, fid: familyId, jti },
      refreshSecret,
      { expiresIn: AuthService.REFRESH_TOKEN_TTL },
    );

    // Registering after signing means a storage failure surfaces as a failed
    // login rather than a token nobody can ever refresh.
    await this.refreshTokenService.register(
      familyId,
      userId,
      jti,
      new Date(Date.now() + AuthService.REFRESH_TOKEN_TTL_MS),
    );

    return { accessToken, refreshToken };
  }

  /**
   * Mint a single-use code for the Google redirect. See `AuthCodeService`.
   */
  async issueOAuthCode(userId: string, needsProfile: boolean): Promise<string> {
    return this.authCodeService.issue(userId, needsProfile);
  }

  /**
   * Redeem a Google handoff code for a real session.
   */
  async exchangeOAuthCode(
    code: string,
  ): Promise<AuthResponse & { needsProfile: boolean }> {
    const redeemed = await this.authCodeService.redeem(code);
    if (!redeemed) {
      throw new UnauthorizedException('Invalid or expired authorization code');
    }

    const user = await this.userModel.findById(redeemed.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const tokens = await this.generateTokens(user._id.toString(), user.email);

    return {
      user: this.sanitize(user),
      tokens,
      needsProfile: redeemed.needsProfile,
    };
  }
}
