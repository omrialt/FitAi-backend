import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Import these as VALUES, never `import type`. A type-only import is erased,
 * `emitDecoratorMetadata` writes `Function` as the parameter type, and the
 * global ValidationPipe then hands the handler `undefined` instead of the
 * request body.
 *
 * Every field carries a decorator for the same reason: the global pipe runs
 * with `whitelist: true`, so an undecorated property is silently stripped and
 * the service receives `{}`.
 */

export class PerformedSetDto {
  @IsInt()
  @Min(0)
  @Max(1000)
  reps!: number;

  @IsNumber()
  @Min(0)
  @Max(2000)
  weight!: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  rpe?: number;
}

export class SessionExerciseDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  muscleGroup?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsArray()
  // A ceiling on nested arrays keeps one request from writing a document that
  // is expensive to validate and to read back.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PerformedSetDto)
  sets!: PerformedSetDto[];
}

export class CreateWorkoutSessionDto {
  @IsOptional()
  @IsMongoId()
  planId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  planTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  dayName?: string;

  /** Defaults to now in the service when the client omits it. */
  @IsOptional()
  @IsDateString()
  performedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => SessionExerciseDto)
  exercises!: SessionExerciseDto[];
}

export class WorkoutStatsQueryDto {
  /**
   * Rolling window for the adherence figure, in days. Streaks and personal
   * bests are all-time and ignore it.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  days?: number;
}

export class ListWorkoutSessionsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
