import {
  IsDateString,
  IsEnum,
  IsMongoId,
  IsOptional,
  ValidateIf,
} from 'class-validator';
// `import type` is required: Phase is a pure type alias, and a value import of
// a type used in a decorated signature is a compile error under
// isolatedModules + emitDecoratorMetadata. @IsEnum([...]) carries the runtime
// rule. (The DTO *classes* in this file are still value-exported, which is what
// makes the ValidationPipe run at all.)
import type { Phase } from '../objects/current-status/current-status.schema';

// Classes, not interfaces — class-validator cannot decorate an interface, so
// the previous shape meant `@Body(ValidationPipe)` validated nothing at all.
// `null` is a meaningful value here (it clears the active plan/menu), so the
// id fields use @ValidateIf to allow null through while still rejecting
// arbitrary strings.

export class UpdateCurrentStatusDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  activeTrainingPlanId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  activeMenuId?: string | null;

  // `Date` is allowed alongside the ISO string because the service calls this
  // same type internally (updateWorkoutDates, markWorkoutCompleted) with real
  // Date objects. Over HTTP a body can only ever carry the string form, which
  // is what @IsDateString checks.
  @IsOptional()
  @IsDateString()
  lastWorkoutDate?: string | Date;

  @IsOptional()
  @IsDateString()
  nextWorkoutDate?: string | Date;

  @IsOptional()
  @IsEnum(['cut', 'bulk', 'maintain'])
  phase?: Phase;
}

export class SetActiveTrainingPlanDto {
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  activeTrainingPlanId!: string | null;
}

export class SetActiveMenuDto {
  @ValidateIf((_, value) => value !== null)
  @IsMongoId()
  activeMenuId!: string | null;
}

export class SetPhaseDto {
  @IsEnum(['cut', 'bulk', 'maintain'])
  phase!: Phase;
}
