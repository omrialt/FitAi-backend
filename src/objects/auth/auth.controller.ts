import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as express from 'express';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  completeProfileSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  googleExchangeSchema,
} from './auth.schemas';
import type {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateProfileDto,
  CompleteProfileDto,
  VerifyEmailDto,
  ResendVerificationDto,
  GoogleExchangeDto,
} from '../../interfaces/auth.interfaces';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * Login with email and password
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body(new ZodValidationPipe(loginSchema)) loginDto: LoginDto) {
    return await this.authService.login(loginDto);
  }

  /**
   * Register new user
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) registerDto: RegisterDto,
  ) {
    return this.authService.register(registerDto);
  }

  /**
   * Logout user
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req: { headers: { authorization?: string } }) {
    // Extract token from authorization header if needed
    const token: string | undefined = req.headers.authorization?.replace(
      'Bearer ',
      '',
    );
    return this.authService.logout(token);
  }

  /**
   * Refresh access token
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Body(new ZodValidationPipe(refreshTokenSchema))
    refreshTokenDto: RefreshTokenDto,
  ) {
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  /**
   * Initiate Google OAuth login
   */
  @Get('google')
  googleAuth(@Res() res: express.Response) {
    const googleAuthUrl = this.authService.getGoogleAuthUrl();
    res.redirect(googleAuthUrl);
  }

  /**
   * Handle Google OAuth callback
   */
  @Get('google/callback')
  async googleCallback(
    @Request() req: express.Request,
    @Res() res: express.Response,
  ) {
    const code = req.query.code as string;
    const error = req.query.error as string;

    if (error) {
      // Redirect to frontend with error
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(
        `${frontendUrl}/login?error=${encodeURIComponent(error)}`,
      );
    }

    if (!code) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/login?error=no_code`);
    }

    try {
      const { userId, needsProfile } =
        await this.authService.handleGoogleCallback(code);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

      // This redirect used to carry accessToken, refreshToken and the whole
      // user object as query parameters, which put a working session into
      // browser history, into the `Referer` of the next request, and into
      // every proxy log on the way. It now carries one opaque single-use code
      // that the frontend trades for tokens over POST.
      const handoff = await this.authService.issueOAuthCode(
        userId,
        needsProfile,
      );
      const params = new URLSearchParams({ code: handoff });

      // If user needs to complete profile, redirect to complete-profile page
      const redirectPath = needsProfile
        ? '/complete-profile'
        : '/auth/google/callback';

      return res.redirect(`${frontendUrl}${redirectPath}?${params.toString()}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Google OAuth authentication failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const encodedError = encodeURIComponent(errorMessage);
      return res.redirect(`${frontendUrl}/login?error=${encodedError}`);
    }
  }

  /**
   * Redeem the single-use code from the Google redirect for a real session.
   *
   * POST rather than GET so the code travels in a body that is not logged,
   * cached or kept in history — the whole point of moving off the query string.
   */
  @Post('google/exchange')
  @HttpCode(HttpStatus.OK)
  async googleExchange(
    @Body(new ZodValidationPipe(googleExchangeSchema))
    dto: GoogleExchangeDto,
  ) {
    return this.authService.exchangeOAuthCode(dto.code);
  }

  /**
   * Get current user profile
   */
  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  async getProfile(@Request() req: AuthRequest) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID is required');
    }
    return this.authService.getProfile(userId);
  }

  /**
   * Update user profile
   */
  @Patch('profile')
  @UseGuards(AuthGuard('jwt'))
  async updateProfile(
    @Request() req: AuthRequest,
    @Body(new ZodValidationPipe(updateProfileSchema))
    updateProfileDto: UpdateProfileDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID is required');
    }
    return this.authService.updateProfile(userId, updateProfileDto);
  }

  /**
   * Complete profile for Google OAuth users
   */
  @Patch('complete-profile')
  @UseGuards(AuthGuard('jwt'))
  async completeProfile(
    @Request() req: AuthRequest,
    @Body(new ZodValidationPipe(completeProfileSchema))
    completeProfileDto: CompleteProfileDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID is required');
    }
    return this.authService.completeProfile(userId, completeProfileDto);
  }

  /**
   * Change password
   */
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'))
  async changePassword(
    @Request() req: AuthRequest,
    @Body(new ZodValidationPipe(changePasswordSchema))
    changePasswordDto: ChangePasswordDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User ID is required');
    }
    return this.authService.changePassword(
      userId,
      changePasswordDto.oldPassword,
      changePasswordDto.newPassword,
    );
  }

  /**
   * Request password reset
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema))
    forgotPasswordDto: ForgotPasswordDto,
  ) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  /**
   * Confirm an email address.
   *
   * The mailed link points at the SPA (`/verify-email?token=…`), which posts
   * the token here — the same shape as the reset-password flow, so both links
   * land on a real page instead of a bare JSON response.
   */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema))
    verifyEmailDto: VerifyEmailDto,
  ) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  /**
   * Request a fresh verification link. Always 204 — see the service for why
   * the response must not depend on whether the address exists.
   */
  @Post('resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendVerification(
    @Body(new ZodValidationPipe(resendVerificationSchema))
    resendDto: ResendVerificationDto,
  ) {
    return this.authService.resendVerification(resendDto.email);
  }

  /**
   * Reset password with token
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema))
    resetPasswordDto: ResetPasswordDto,
  ) {
    return this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.newPassword,
    );
  }
}
