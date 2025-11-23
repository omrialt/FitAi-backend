import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import type { User } from '../user/user.schema';

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  fullName: string;
  gender: 'male' | 'female' | 'other';
  birthDate: string;
  height?: number;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface ChangePasswordDto {
  oldPassword: string;
  newPassword: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  token: string;
  newPassword: string;
}

export interface UpdateProfileDto {
  fullName?: string;
  gender?: 'male' | 'female' | 'other';
  birthDate?: string;
  height?: number;
  profileImage?: string;
}

export interface AuthResponse {
  user: Omit<User, 'password'>;
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}

@Injectable()
export class AuthService {
  constructor(@InjectModel('User') private readonly userModel: Model<User>) {}

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

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate tokens
    const tokens = this.generateTokens(user._id.toString(), user.email);

    // Remove password from response
    const { password: _, ...userObject } = user.toObject();

    return {
      user: userObject,
      tokens,
    };
  }

  /**
   * Register new user
   */
  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const { email, password, ...userData } = registerDto;

    // Check if user already exists
    const existingUser = await this.userModel.findOne({ email });
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.userModel.create({
      email,
      password: hashedPassword,
      ...userData,
      role: 'user', // Default role
    });

    // Generate tokens
    const tokens = this.generateTokens(user._id.toString(), user.email);

    // Remove password from response
    const { password: _, ...userObject } = user.toObject();

    return {
      user: userObject,
      tokens,
    };
  }

  /**
   * Logout user
   */
  logout(token?: string): void {
    // TODO: Implement token blacklisting if needed
    // For now, client-side token removal is sufficient
    return;
  }

  /**
   * Refresh access token
   */
  async refreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const secret = process.env.JWT_REFRESH_SECRET || 'refresh-secret';
      const payload = jwt.verify(refreshToken, secret) as {
        userId: string;
        email: string;
      };

      // Verify user still exists
      const user = await this.userModel.findById(payload.userId);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Generate new tokens
      return this.generateTokens(user._id.toString(), user.email);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Get Google OAuth URL
   */
  getGoogleAuthUrl(): string {
    const clientId = process.env.GOOGLE_CLIENT_ID || 'your-google-client-id';
    const redirectUri =
      process.env.GOOGLE_CALLBACK_URL ||
      'http://localhost:3000/auth/google/callback';

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
  handleGoogleCallback(code: string): Promise<AuthResponse> {
    // TODO: Implement actual Google OAuth token exchange
    // This is a placeholder implementation
    throw new BadRequestException('Google OAuth not fully implemented yet');
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

    // TODO: Generate reset token and send email
    // For now, just return success
    console.log('Password reset requested for:', email);
  }

  /**
   * Reset password with token
   */
  resetPassword(token: string, newPassword: string): Promise<void> {
    // TODO: Implement token verification and password reset
    throw new BadRequestException('Password reset not fully implemented yet');
  }

  /**
   * Generate JWT tokens
   */
  private generateTokens(
    userId: string,
    email: string,
  ): { accessToken: string; refreshToken: string } {
    const accessSecret = process.env.JWT_ACCESS_SECRET || 'access-secret';
    const refreshSecret = process.env.JWT_REFRESH_SECRET || 'refresh-secret';

    const accessToken = jwt.sign({ userId, email }, accessSecret, {
      expiresIn: '15m',
    });

    const refreshToken = jwt.sign({ userId, email }, refreshSecret, {
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }
}
