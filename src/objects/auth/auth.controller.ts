import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  HttpCode,
  HttpStatus,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as express from 'express';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';
import type {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateProfileDto,
  CompleteProfileDto,
} from '../interfaces/auth.interfaces';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Login with email and password
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return await this.authService.login(loginDto);
  }

  /**
   * Register new user
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /**
   * Logout user
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Request() req: { headers: { authorization?: string } }) {
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
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
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
      const authResponse = await this.authService.handleGoogleCallback(code);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

      // Redirect to frontend with tokens in URL (temporary, will be stored in frontend)
      const params = new URLSearchParams({
        accessToken: authResponse.tokens.accessToken,
        refreshToken: authResponse.tokens.refreshToken,
        user: JSON.stringify(authResponse.user),
      });

      // If user needs to complete profile, redirect to complete-profile page
      const redirectPath = authResponse.needsProfile
        ? '/complete-profile'
        : '/auth/google/callback';

      return res.redirect(`${frontendUrl}${redirectPath}?${params.toString()}`);
    } catch {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/login?error=auth_failed`);
    }
  }

  /**
   * Get current user profile
   */
  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  async getProfile(@Request() req: AuthRequest) {
    console.log('📝 Profile endpoint - req.user:', req.user);
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
  async updateProfile(
    @Request() req: AuthRequest,
    @Body() updateProfileDto: UpdateProfileDto,
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
  async completeProfile(
    @Request() req: AuthRequest & { headers: { authorization?: string } },
    @Body() completeProfileDto: CompleteProfileDto,
  ) {
    // Try to get userId from req.user (if middleware set it) or decode from JWT
    let userId = req.user?.id;

    if (!userId) {
      // Extract and decode JWT to get userId
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        try {
          const secret = process.env.JWT_ACCESS_SECRET || 'access-secret';
          const decoded = jwt.verify(token, secret) as { userId: string };
          userId = decoded.userId;
        } catch {
          throw new Error('Invalid or expired token');
        }
      }
    }

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
  async changePassword(
    @Request() req: AuthRequest,
    @Body() changePasswordDto: ChangePasswordDto,
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
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  /**
   * Reset password with token
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.newPassword,
    );
  }
}
