import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { physicalTargetStatusValues } from '../objects/physical-target/physical-target.schema';

/**
 * These DTOs must be imported as VALUES (`import { ... }`), never
 * `import type` — see the same note on physical-data.interfaces.ts. A
 * type-only import erases the class, and Nest's ValidationPipe then hands
 * the handler `undefined` instead of the request body.
 */
export class TargetValuesDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(700)
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  bodyFatPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  chest?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  waist?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  hips?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  arms?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  legs?: number;
}

export class CreatePhysicalTargetDto {
  // Present so an admin can file a target for someone else. For everyone
  // else the controller overwrites it with the caller's own id before it
  // reaches the service, mirroring physical-data's create route.
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsDateString()
  targetDate!: string;

  @ValidateNested()
  @Type(() => TargetValuesDto)
  targetValues!: TargetValuesDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdatePhysicalTargetDto extends PartialType(
  CreatePhysicalTargetDto,
) {
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @IsOptional()
  @IsIn(physicalTargetStatusValues)
  status?: (typeof physicalTargetStatusValues)[number];
}
