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

/**
 * The Google handoff code is 32 random bytes rendered as hex, so the length is
 * fixed. Validating it here means a malformed code is a 400 before it reaches
 * the database rather than a lookup miss.
 */
export const googleExchangeSchema = z.object({
  code: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid authorization code'),
  // PKCE verifier, sent only by the Android app (RFC 7636 §4.1 alphabet).
  codeVerifier: z
    .string()
    .regex(/^[A-Za-z0-9\-._~]{43,128}$/, 'Invalid code verifier')
    .optional(),
});

/**
 * Query of `GET /auth/google`. Empty for the web; the Android app sends its
 * platform and a PKCE S256 challenge, which is always 43 base64url characters.
 */
export const googleAuthQuerySchema = z.union([
  z.object({
    platform: z.literal('android'),
    challenge: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid code challenge'),
  }),
  z.object({ platform: z.undefined() }).passthrough(),
]);

export const completeProfileSchema = z.object({
  fullName: z.string().min(1),
  gender: z.enum(['male', 'female', 'other']),
  birthDate: z.string(),
  role: z.enum(['user', 'trainer']),
  height: z.number().positive().optional(),
});
