import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Import these as VALUES, never `import type` — a type-only import is erased,
 * `emitDecoratorMetadata` writes `Function` as the parameter type, and the
 * global ValidationPipe hands the handler `undefined` instead of the query.
 */

export class SearchFoodDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;
}

export class ParseFoodDto {
  /**
   * Capped at 500 characters. A meal description is a sentence or two; the
   * limit is here because this text becomes a prompt, and an unbounded field
   * in front of a paid API is a bill someone else can run up.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  text!: string;
}
