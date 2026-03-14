import { Exercise } from '../objects/training-plan/training-plan.schema';

export class CreateTrainingPlanDto {
  userId!: string;
  title!: string;
  description!: string;
  durationWeeks!: number;
  exercises?: Exercise[];
  difficulty?: string;
}

export class UpdateTrainingPlanDto {
  title?: string;
  description?: string;
  durationWeeks?: number;
  exercises?: Exercise[];
  difficulty?: string;
}
