import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { EQUIPMENT, MUSCLE_GROUPS } from '../objects/exercise/exercise.schema';

/**
 * Import these as VALUES, never `import type` — a type-only import is erased,
 * `emitDecoratorMetadata` writes `Function` as the parameter type, and the
 * global ValidationPipe hands the handler `undefined` instead of the body.
 */

export const COACH_GOALS = [
  'strength',
  'hypertrophy',
  'fat_loss',
  'general',
] as const;

export const EXPERIENCE_LEVELS = [
  'beginner',
  'intermediate',
  'advanced',
] as const;

export class ChatTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(2000)
  content!: string;
}

export class CoachChatDto {
  /**
   * Bounded because it becomes a prompt. An unbounded text field in front of a
   * paid API is a bill anyone with an account can run up, and no real question
   * about a training log is longer than this.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  question!: string;

  /**
   * The conversation so far, held by the client and re-sent each turn. Nothing
   * server-side stores it — a chat log about someone's body and habits is a new
   * category of personal data, and this feature does not earn one.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];
}

export class GeneratePlanDto {
  @IsIn(COACH_GOALS)
  goal!: (typeof COACH_GOALS)[number];

  @IsInt()
  @Min(1)
  @Max(6)
  daysPerWeek!: number;

  /** What the user actually has. Narrows the catalogue the model may pick from. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(EQUIPMENT, { each: true })
  equipment?: (typeof EQUIPMENT)[number][];

  /**
   * Areas not to load. Named as muscle groups rather than free text on
   * purpose: "avoid loading the shoulder" is a programming constraint the
   * catalogue can enforce, while "I have a torn rotator cuff" is a medical
   * detail this app should neither store nor reason about.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(MUSCLE_GROUPS, { each: true })
  avoid?: (typeof MUSCLE_GROUPS)[number][];

  @IsOptional()
  @IsIn(EXPERIENCE_LEVELS)
  experience?: (typeof EXPERIENCE_LEVELS)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @IsOptional()
  @IsIn(['he', 'en'])
  language?: string;
}
