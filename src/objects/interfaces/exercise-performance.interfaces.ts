export interface CreateExercisePerformanceDto {
  userId: string;
  exerciseId: string;
  trainingPlanId?: string;
  trainingDayName: string;
  setIndex: number;
  weight: number;
  reps: number;
  timestamp: Date;
  notes?: string;
}

export interface UpdateExercisePerformanceDto {
  trainingPlanId?: string;
  trainingDayName?: string;
  setIndex?: number;
  weight?: number;
  reps?: number;
  timestamp?: Date;
  notes?: string;
}
