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
} from '@nestjs/common';
import * as express from 'express';
import { AuthService } from './auth.service';
import type {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './auth.service';

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
  @Post('google/callback')
  @HttpCode(HttpStatus.OK)
  async googleCallback(@Body() body: { code: string }) {
    return this.authService.handleGoogleCallback(body.code);
  }

  /**
   * Get current user profile
   */
  @Get('profile')
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
