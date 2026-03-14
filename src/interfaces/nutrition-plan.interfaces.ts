import { Meal } from '../objects/nutrition-plan/nutrition-plan.schema';

export class CreateNutritionPlanDto {
  userId!: string;
  title!: string;
  description!: string;
  totalCalories!: number;
  meals?: Meal[];
}

export class UpdateNutritionPlanDto {
  title?: string;
  description?: string;
  totalCalories?: number;
  meals?: Meal[];
}
