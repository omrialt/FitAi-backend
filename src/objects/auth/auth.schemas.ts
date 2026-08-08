import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1),
  gender: z.enum(['male', 'female', 'other']),
  birthDate: z.string(),
  role: z.enum(['user', 'trainer']),
  height: z.number().positive().optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(6),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  birthDate: z.string().optional(),
  height: z.number().positive().optional(),
  avatarUrl: z.string().url().optional(),
});

export const completeProfileSchema = z.object({
  fullName: z.string().min(1),
  gender: z.enum(['male', 'female', 'other']),
  birthDate: z.string(),
  role: z.enum(['user', 'trainer']),
  height: z.number().positive().optional(),
});
