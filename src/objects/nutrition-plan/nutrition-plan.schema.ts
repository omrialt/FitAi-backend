import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define Zod enums
export const mealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

// Define the Food schema
export const foodSchema = z.object({
  name: z.string({
    required_error: 'Food name is required',
    invalid_type_error: 'Food name must be a string',
  }),
  quantityGrams: z
    .number({
      required_error: 'Quantity in grams is required',
      invalid_type_error: 'Quantity must be a number',
    })
    .positive(),
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

// Define the Zod schema for validation
export const nutritionPlanSchema = z.object({
  userId: z.string({
    required_error: 'User ID is required',
    invalid_type_error: 'User ID must be a string',
  }),
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
  meals: z.array(mealSchema).default([]),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create types from Zod schema
export type NutritionPlan = z.infer<typeof nutritionPlanSchema>;
export type Meal = z.infer<typeof mealSchema>;
export type Food = z.infer<typeof foodSchema>;
export type MealType = z.infer<typeof mealTypeSchema>;

// Define Mongoose schema
export const NutritionPlanSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    totalCalories: { type: Number, required: true },
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
                quantityGrams: { type: Number, required: true },
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

// Add validation middleware
NutritionPlanSchema.pre('save', function (next) {
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
