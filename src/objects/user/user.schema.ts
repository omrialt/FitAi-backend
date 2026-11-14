import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Interface for the document during validation
interface UserDocumentForValidation {
  authProvider: string;
}

// Define Zod enums
export const userRoleSchema = z.enum(['user', 'trainer', 'admin']);
export const authProviderSchema = z.enum(['email', 'google']);
export const genderSchema = z.enum(['male', 'female', 'other']);
export const targetSchema = z.enum(['maintain', 'cut', 'bulk']);

// Define the Zod schema for validation
export const userSchema = z.object({
  fullName: z
    .string({
      required_error: 'Full name is required',
      invalid_type_error: 'Full name must be a string',
    })
    .min(2, 'Full name must be at least 2 characters'),
  email: z
    .string({
      required_error: 'Email is required',
      invalid_type_error: 'Email must be a string',
    })
    .email('Invalid email format'),
  password: z
    .string({
      invalid_type_error: 'Password must be a string',
    })
    .min(6, 'Password must be at least 6 characters')
    .optional(),
  role: userRoleSchema.default('user'),
  authProvider: authProviderSchema.default('email'),
  gender: genderSchema.optional(),
  birthDate: z.date().optional(),
  height: z.number().positive('Height must be a positive number').optional(),
  target: targetSchema.optional(),
  trainerId: z
    .union([z.string(), z.object({}).passthrough()])
    .optional()
    .nullable(),
  avatarUrl: z.string().url('Invalid URL format').optional(),
  emailVerified: z.boolean().default(false),
  isActive: z.boolean().default(true),
  lastLogin: z.date().optional(),
  lastLogout: z.date().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  resetPasswordToken: z.string().optional(),
  resetPasswordExpires: z.date().optional(),
  // Set at registration and cleared the moment the link is used, so a spent
  // token cannot verify a second account.
  emailVerificationToken: z.string().optional(),
  emailVerificationExpires: z.date().optional(),
  timezone: z.string().default('UTC'),
  googleCalendar: z
    .object({
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      expiryDate: z.number().optional(),
      connected: z.boolean().default(false),
    })
    .optional(),
});

// Create types from Zod schema
export type User = z.infer<typeof userSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type AuthProvider = z.infer<typeof authProviderSchema>;
export type Gender = z.infer<typeof genderSchema>;
export type Target = z.infer<typeof targetSchema>;

// Define Mongoose schema
export const UserSchema = new Schema(
  {
    fullName: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: function (this: UserDocumentForValidation) {
        // Password only required for email auth provider
        return this.authProvider === 'email';
      },
      select: false,
    },
    role: {
      type: String,
      enum: ['user', 'trainer', 'admin'],
      default: 'user',
    },
    authProvider: {
      type: String,
      enum: ['email', 'google'],
      default: 'email',
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
    },
    birthDate: { type: Date },
    height: { type: Number, min: 0 },
    target: {
      type: String,
      enum: ['maintain', 'cut', 'bulk'],
    },
    trainerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    avatarUrl: { type: String },
    emailVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
    lastLogout: { type: Date },
    // Hidden by default (security: SEC-01). A reset token is a password: it
    // was once returned by `GET /users` to every signed-in account, which let
    // anyone request a reset for someone else and then read the token back.
    // Stored as a SHA-256 digest, never the mailed value (SEC-05).
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    // `select: false` for the same reason as `password`: neither belongs in a
    // profile response, and a leaked verification token is a free account.
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    timezone: { type: String, default: 'UTC' },
    // Which push notifications this user wants (PushService checks before
    // every send). Missing means on: every kind defaults to true.
    notificationPrefs: {
      messages: { type: Boolean, default: true },
      plans: { type: Boolean, default: true },
      connections: { type: Boolean, default: true },
    },
    googleCalendar: {
      // OAuth credentials for the user's Google Calendar. Hidden by default
      // (SEC-01): only the calendar-sync code reads them, with an explicit
      // `+googleCalendar.accessToken +googleCalendar.refreshToken` select.
      accessToken: { type: String, select: false },
      refreshToken: { type: String, select: false },
      expiryDate: { type: Number },
      connected: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

// Add indexes
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });
// Verification looks a user up by token alone, so without this the link
// handler is a collection scan on every click.
UserSchema.index({ emailVerificationToken: 1 });

// Add virtual for related documents
UserSchema.virtual('trainingPlans', {
  ref: 'TrainingPlan',
  localField: '_id',
  foreignField: 'userId',
});

UserSchema.virtual('nutritionPlans', {
  ref: 'NutritionPlan',
  localField: '_id',
  foreignField: 'userId',
});

UserSchema.virtual('aiRecommendations', {
  ref: 'AiRecommendation',
  localField: '_id',
  foreignField: 'userId',
});

UserSchema.virtual('physicalData', {
  ref: 'PhysicalData',
  localField: '_id',
  foreignField: 'userId',
});

/** Fields that must never be serialised into an API response. */
export const USER_SECRET_FIELDS = [
  'password',
  'resetPasswordToken',
  'resetPasswordExpires',
  'emailVerificationToken',
  'emailVerificationExpires',
] as const;

/**
 * Strips credentials from a plain user object. Second line of defence behind
 * `select: false` (SEC-01): a query that opts a secret back in for internal
 * use still cannot leak it if the document ends up in a response.
 */
export function stripUserSecrets<T extends Record<string, unknown>>(ret: T): T {
  for (const field of USER_SECRET_FIELDS) {
    delete ret[field];
  }
  const calendar = ret.googleCalendar as Record<string, unknown> | undefined;
  if (calendar && typeof calendar === 'object') {
    delete calendar.accessToken;
    delete calendar.refreshToken;
  }
  return ret;
}

// Enable virtuals in JSON. Only toJSON strips secrets: toObject feeds the
// pre-save validation below and internal code that legitimately reads them.
UserSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => stripUserSecrets(ret),
});
UserSchema.set('toObject', { virtuals: true });

// Add validation middleware
UserSchema.pre('save', function (next) {
  const result = userSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

// Type for a hydrated document
export type UserDocument = HydratedDocument<User>;

// Type for the model
export type UserModel = Model<UserDocument>;
