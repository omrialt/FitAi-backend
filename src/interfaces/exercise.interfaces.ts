import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { EQUIPMENT, MUSCLE_GROUPS } from '../objects/exercise/exercise.schema';

/**
 * Import these as VALUES, never `import type` — a type-only import is erased,
 * `emitDecoratorMetadata` writes `Function` as the parameter type, and the
 * global ValidationPipe hands the handler `undefined` instead of the query.
 */

export class SearchExercisesDto {
  /** Matched against the English name, the Hebrew name and the aliases. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(MUSCLE_GROUPS)
  muscleGroup?: (typeof MUSCLE_GROUPS)[number];

  @IsOptional()
  @IsIn(EQUIPMENT)
  equipment?: (typeof EQUIPMENT)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SubstituteExercisesDto {
  /** The name exactly as the training plan stores it. */
  @IsString()
  @MaxLength(120)
  name!: string;

  /** Narrows to what is actually free in the gym right now. */
  @IsOptional()
  @IsIn(EQUIPMENT)
  equipment?: (typeof EQUIPMENT)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class ExerciseAlternativesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
