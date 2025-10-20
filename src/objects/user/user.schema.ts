import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define Zod enums
export const userRoleSchema = z.enum(['user', 'trainer', 'admin']);
export const authProviderSchema = z.enum(['email', 'google']);

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
      required_error: 'Password is required',
      invalid_type_error: 'Password must be a string',
    })
    .min(6, 'Password must be at least 6 characters'),
  role: userRoleSchema.default('user'),
  authProvider: authProviderSchema.default('email'),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create types from Zod schema
export type User = z.infer<typeof userSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type AuthProvider = z.infer<typeof authProviderSchema>;

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
    password: { type: String, required: true, select: false },
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
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

// Add indexes
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });

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

// Enable virtuals in JSON
UserSchema.set('toJSON', { virtuals: true });
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
