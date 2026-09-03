import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  PHOTO_POSES,
  PHOTO_VISIBILITIES,
} from '../objects/body-photo/body-photo.schema';

/**
 * Import these as VALUES, never `import type` — a type-only import is erased,
 * `emitDecoratorMetadata` writes `Function` as the parameter type, and the
 * global ValidationPipe hands the handler `undefined` instead of the body.
 */

export class CreateBodyPhotoDto {
  @IsOptional()
  @IsIn(PHOTO_POSES)
  pose?: (typeof PHOTO_POSES)[number];

  /**
   * Multipart form fields arrive as strings, so this needs the transform even
   * though the type says number.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(20)
  @Max(500)
  weightKg?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  /** People upload three months of backlog in one evening. */
  @IsOptional()
  @IsDateString()
  takenAt?: string;

  /**
   * There is no `visibility` here on purpose. A photo is private when it is
   * created, full stop, and becomes shareable only through an explicit second
   * request — so there is no field on the upload path that could share one by
   * accident, and no default anyone can get wrong.
   */
}

export class SetPhotoVisibilityDto {
  @IsIn(PHOTO_VISIBILITIES)
  visibility!: (typeof PHOTO_VISIBILITIES)[number];
}
