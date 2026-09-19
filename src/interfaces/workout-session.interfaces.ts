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
  MinLength,
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

/**
 * One reduction inside a drop set. No `rpe` — the effort rating belongs to the
 * sequence as a whole, which is taken to failure by definition.
 */
export class PerformedDropDto {
  @IsInt()
  @Min(0)
  @Max(1000)
  reps!: number;

  @IsNumber()
  @Min(0)
  @Max(2000)
  weight!: number;
}

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

  /**
   * Reductions taken without rest after the set above.
   *
   * Capped at six: past that it is not a drop set, it is a data-entry accident,
   * and every one of these lands in a nested array the server has to validate.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => PerformedDropDto)
  drops?: PerformedDropDto[];
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
  /**
   * Idempotency key minted by the client. Present only for sessions that went
   * through the offline queue; sending the same one twice is a no-op.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  clientId?: string;

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

export class ExerciseHistoryQueryDto {
  /**
   * Which exercise to plot. Omitted means "the one trained most often", so the
   * chart opens on something rather than on an empty state.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Bounds the curve only — the exercise picker stays all-time. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(3650)
  days?: number;
}

export class ListWorkoutSessionsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /**
   * Narrow to the sessions logged against one plan.
   *
   * `@IsMongoId` rather than `@IsString`: an unparseable id reaching the
   * filter is a Mongoose CastError — a 500 for what is a bad request.
   */
  @IsOptional()
  @IsMongoId()
  planId?: string;

  /**
   * Narrow to one day of that plan, by the name it was performed under.
   *
   * The name and not an index, because that is what a session stores. It is
   * denormalised precisely so the log survives the plan being edited or
   * deleted, and an index into a `days` array that may since have been
   * reordered would point at a different workout.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  dayName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class OverloadQueryDto {
  /**
   * Narrow to one exercise. Omitted returns every lift with enough history,
   * which is what the dashboard card wants; the session screen passes a name.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  exercise?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number;
}
