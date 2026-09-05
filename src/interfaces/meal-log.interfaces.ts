import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import {
  FOOD_UNITS,
  MEAL_SOURCES,
  MEAL_TYPES,
} from '../objects/meal-log/meal-log.schema';

/**
 * Import these as VALUES, never `import type` — a type-only import is erased,
 * `emitDecoratorMetadata` writes `Function` as the parameter type, and the
 * global ValidationPipe hands the handler `undefined` instead of the body.
 */

export class LoggedFoodDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  quantity?: number;

  @IsOptional()
  @IsIn(FOOD_UNITS)
  unit?: (typeof FOOD_UNITS)[number];

  // Upper bounds are deliberate. These are hand-typed numbers on a form, and a
  // stray zero should be a validation error rather than a daily total nobody
  // can explain.
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(20000)
  calories!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2000)
  protein!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2000)
  carbs!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2000)
  fat!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fdcId?: number;
}

export class CreateMealLogDto {
  /**
   * The calendar day in the *user's* timezone, `YYYY-MM-DD`.
   *
   * Required, and never defaulted server-side. Production runs in UTC, so a
   * server-computed day would put a 23:30 meal on tomorrow — the same class of
   * bug as N-21, which counted weeks from a Thursday epoch.
   */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'localDay must be YYYY-MM-DD in the user’s own timezone',
  })
  localDay!: string;

  @IsIn(MEAL_TYPES)
  mealType!: (typeof MEAL_TYPES)[number];

  /** Provenance only; nothing branches on it. */
  @IsOptional()
  @IsIn(MEAL_SOURCES)
  source?: (typeof MEAL_SOURCES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => LoggedFoodDto)
  foods!: LoggedFoodDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsISO8601()
  loggedAt?: string;
}

export class DayQueryDto {
  /** Omitted means "whatever the server thinks today is" — only safe as a fallback. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day?: string;
}

export class RangeQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}
