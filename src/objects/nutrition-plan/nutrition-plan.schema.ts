import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define Zod enums
export const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export const targetSchema = z.enum(['maintain', 'cut', 'bulk']);
export const accessLevelSchema = z.enum(['view', 'edit']);
export const objectTypeSchema = z.enum(['trainingPlan', 'nutritionPlan']);

// Define SharedAccessEntry schema
export const sharedAccessEntrySchema = z.object({
  userId: z.union([
    z.string({
      required_error: 'User ID is required for shared access',
      invalid_type_error: 'User ID must be a string',
    }),
    z.object({}).passthrough(), // Accepts ObjectId or any object
  ]),
  accessLevel: accessLevelSchema,
  objectType: objectTypeSchema,
});

// Define the Food schema
export const foodSchema = z.object({
  name: z.string({
    required_error: 'Food name is required',
    invalid_type_error: 'Food name must be a string',
  }),
  quantity: z
    .number({
      invalid_type_error: 'Quantity must be a number',
    })
    .positive()
    .optional()
    .nullable(),
  unit: z
    .enum(['g', 'kg', 'ml', 'l', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'unit'])
    .optional()
    .nullable(),
  calories: z
    .number({
      required_error: 'Calories are required',
      invalid_type_error: 'Calories must be a number',
    })
    .nonnegative(),
  protein: z
    .number({
      required_error: 'Protein is required',
      invalid_type_error: 'Protein must be a number',
    })
    .nonnegative(),
  carbs: z
    .number({
      required_error: 'Carbs are required',
      invalid_type_error: 'Carbs must be a number',
    })
    .nonnegative(),
  fat: z
    .number({
      required_error: 'Fat is required',
      invalid_type_error: 'Fat must be a number',
    })
    .nonnegative(),
});

// Define the Meal schema
export const mealSchema = z.object({
  mealType: mealTypeSchema,
  foods: z.array(foodSchema).default([]),
});

// Define the Rating schema
export const ratingSchema = z.object({
  userId: z.union([
    z.string({
      required_error: 'User ID is required for shared access',
      invalid_type_error: 'User ID must be a string',
    }),
    z.object({}).passthrough(),
  ]),
  rating: z
    .number({
      required_error: 'Rating is required',
      invalid_type_error: 'Rating must be a number',
    })
    .int()
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating must be at most 5'),
  comment: z.string().optional(),
  createdAt: z.date().default(() => new Date()),
});

// Define the Zod schema for validation
export const nutritionPlanSchema = z.object({
  userId: z.union([z.string(), z.object({}).passthrough()]),
  title: z.string({
    required_error: 'Title is required',
    invalid_type_error: 'Title must be a string',
  }),
  description: z.string({
    required_error: 'Description is required',
    invalid_type_error: 'Description must be a string',
  }),
  totalCalories: z
    .number({
      required_error: 'Total calories are required',
      invalid_type_error: 'Total calories must be a number',
    })
    .positive(),
  target: targetSchema.optional(),
  meals: z.array(mealSchema).default([]),
  ratings: z.array(ratingSchema).default([]),
  averageRating: z.number().min(0).max(5).default(0),
  totalRatings: z.number().int().nonnegative().default(0),
  sharedWith: z.array(z.string()).default([]),
  sharedAccess: z.array(sharedAccessEntrySchema).default([]),
  activeByUsers: z
    .array(z.union([z.string(), z.object({}).passthrough()]))
    .default([]),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create types from Zod schema
export type NutritionPlan = z.infer<typeof nutritionPlanSchema>;
export type Meal = z.infer<typeof mealSchema>;
export type Food = z.infer<typeof foodSchema>;
export type Rating = z.infer<typeof ratingSchema>;
export type MealType = z.infer<typeof mealTypeSchema>;
export type Target = z.infer<typeof targetSchema>;
export type SharedAccessEntry = z.infer<typeof sharedAccessEntrySchema>;
export type AccessLevel = z.infer<typeof accessLevelSchema>;
export type ObjectType = z.infer<typeof objectTypeSchema>;

// Define Mongoose Rating schema
const RatingMongooseSchema = {
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String },
  createdAt: { type: Date, required: true, default: Date.now },
};

// Define Mongoose schema
export const NutritionPlanSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    totalCalories: { type: Number, required: true },
    target: {
      type: String,
      enum: ['maintain', 'cut', 'bulk'],
      required: false,
    },
    meals: {
      type: [
        {
          mealType: {
            type: String,
            enum: ['breakfast', 'lunch', 'dinner', 'snack'],
            required: true,
          },
          foods: {
            type: [
              {
                name: { type: String, required: true },
                quantity: { type: Number, required: false },
                unit: {
                  type: String,
                  enum: [
                    'g',
                    'kg',
                    'ml',
                    'l',
                    'oz',
                    'lb',
                    'cup',
                    'tbsp',
                    'tsp',
                    'unit',
                  ],
                  required: false,
                },
                calories: { type: Number, required: true },
                protein: { type: Number, required: true },
                carbs: { type: Number, required: true },
                fat: { type: Number, required: true },
              },
            ],
            default: [],
          },
        },
      ],
      default: [],
    },
    ratings: {
      type: [RatingMongooseSchema],
      default: [],
    },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    totalRatings: { type: Number, default: 0, min: 0 },
    sharedWith: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    sharedAccess: {
      type: [
        {
          userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          accessLevel: {
            type: String,
            enum: ['view', 'edit'],
            required: true,
          },
          objectType: {
            type: String,
            enum: ['trainingPlan', 'nutritionPlan'],
            required: true,
          },
        },
      ],
      default: [],
    },
    activeByUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  {
    timestamps: true,
    validateBeforeSave: true,
  },
);

// Add indexes
NutritionPlanSchema.index({ userId: 1 });
NutritionPlanSchema.index({ totalCalories: 1 });
NutritionPlanSchema.index({ createdAt: -1 });
NutritionPlanSchema.index({ averageRating: -1 });
NutritionPlanSchema.index({ totalRatings: -1 });
NutritionPlanSchema.index({ 'ratings.userId': 1 });
NutritionPlanSchema.index({ 'ratings.rating': -1 });
NutritionPlanSchema.index({ 'ratings.createdAt': -1 });
NutritionPlanSchema.index({ sharedWith: 1 });
NutritionPlanSchema.index({ 'sharedAccess.userId': 1 });
NutritionPlanSchema.index({ 'sharedAccess.accessLevel': 1 });
NutritionPlanSchema.index({ activeByUsers: 1 });

// Add middleware to calculate average rating and total ratings
NutritionPlanSchema.pre('save', function (next) {
  // Calculate average rating and total ratings
  if (this.ratings && this.ratings.length > 0) {
    const totalRating = this.ratings.reduce(
      (sum: number, rating: { rating: number }) => sum + rating.rating,
      0,
    );
    this.averageRating = Number((totalRating / this.ratings.length).toFixed(2));
    this.totalRatings = this.ratings.length;
  } else {
    this.averageRating = 0;
    this.totalRatings = 0;
  }

  // Validate with Zod schema
  const result = nutritionPlanSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

// Type for a hydrated document
export type NutritionPlanDocument = HydratedDocument<NutritionPlan>;

// Type for the model
export type NutritionPlanModel = Model<NutritionPlanDocument>;
