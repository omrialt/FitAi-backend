import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsMongoId,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * These DTOs must be imported as VALUES (`import { ... }`), never
 * `import type`. A type-only import is erased, `emitDecoratorMetadata` then
 * writes `Function` as the parameter type, and Nest's global ValidationPipe
 * hands the handler `undefined` instead of the request body — which is exactly
 * how `POST /physical-data` came to fail with "weightKg is required" no matter
 * what the client sent.
 */
export class MeasurementsDto {
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

export class CreatePhysicalDataDto {
  // Present so an admin can file a reading for someone else. For everyone else
  // the controller overwrites it with the caller's own id before it reaches the
  // service, so a client cannot attribute a measurement to another user.
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(300)
  heightCm?: number;

  @IsNumber()
  @Min(0)
  @Max(700)
  weightKg!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  bodyFatPercent?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => MeasurementsDto)
  measurements?: MeasurementsDto;

  @IsOptional()
  @IsDateString()
  dateRecorded?: string;
}

export class UpdatePhysicalDataDto extends PartialType(CreatePhysicalDataDto) {
  @IsOptional()
  @IsMongoId()
  userId?: string;
}
