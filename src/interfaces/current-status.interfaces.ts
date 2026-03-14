import { Phase } from '../objects/current-status/current-status.schema';

export interface UpdateCurrentStatusDto {
  activeTrainingPlanId?: string | null;
  activeMenuId?: string | null;
  lastWorkoutDate?: Date;
  nextWorkoutDate?: Date;
  phase?: Phase;
}

export interface SetActiveTrainingPlanDto {
  activeTrainingPlanId: string | null;
}

export interface SetActiveMenuDto {
  activeMenuId: string | null;
}

export interface SetPhaseDto {
  phase: Phase;
}
