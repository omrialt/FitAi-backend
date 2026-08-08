import type { User } from '../objects/user/user.schema';

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
  role: 'user' | 'trainer';
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

export interface VerifyEmailDto {
  token: string;
}

export interface ResendVerificationDto {
  email: string;
}

export interface UpdateProfileDto {
  fullName?: string;
  gender?: 'male' | 'female' | 'other';
  birthDate?: string;
  height?: number;
  avatarUrl?: string;
}

export interface CompleteProfileDto {
  fullName: string;
  gender: 'male' | 'female' | 'other';
  birthDate: string;
  role: 'user' | 'trainer';
  height?: number;
}

export interface AuthResponse {
  user: Omit<User, 'password'> & { _id: string };
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
}
