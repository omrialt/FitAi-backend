import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
// `import type` is required here: RecommendationCategory is a pure type alias,
// and with isolatedModules + emitDecoratorMetadata a value import of a type in a
// decorated signature is a compile error. The runtime rule comes from
// @IsEnum([...]) below, not from the metadata.
import type { RecommendationCategory } from '../objects/ai-recommendation/ai-recommendation.schema';

// Import these as VALUES, not `import type` — see the note in
// physical-data.interfaces.ts for why a type-only import silently empties the
// request body.

export class RecommendationMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  prompt?: string;

  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tokensUsed?: number;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class CreateAiRecommendationDto {
  @IsMongoId()
  userId!: string;

  @IsEnum(['training', 'nutrition', 'general'])
  category!: RecommendationCategory;

  @IsString()
  @MaxLength(5000)
  content!: string;

  // The Mongoose schema marks this required, but the old DTO had no such field,
  // so a create could not have satisfied the schema even once the body arrived.
  @IsEnum(['ai', 'trainer'])
  generatedBy!: 'ai' | 'trainer';

  @IsOptional()
  @IsString()
  aiModelUsed?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecommendationMetadataDto)
  metadata?: RecommendationMetadataDto;
}

export class UpdateAiRecommendationDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecommendationMetadataDto)
  metadata?: RecommendationMetadataDto;
}
