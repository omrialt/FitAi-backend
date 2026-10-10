import { IsInt, IsNumber, Max, Min } from 'class-validator';
import { ALERT_SETTING_BOUNDS } from '../objects/trainer-dashboard/trainer-alert-settings.schema';

const { idleDays, stallMinSpanDays, stallMaxChangeKg } = ALERT_SETTING_BOUNDS;

/**
 * The whole set, every time — a PUT, not a PATCH. The ordering rule between
 * the two idle thresholds can only be checked with both in hand.
 *
 * Import as a VALUE, never `import type`: a type-only import erases the class
 * and the ValidationPipe then hands the handler `undefined`.
 */
export class UpdateTrainerAlertSettingsDto {
  @IsInt()
  @Min(idleDays.min)
  @Max(idleDays.max)
  idleInfoDays!: number;

  @IsInt()
  @Min(idleDays.min)
  @Max(idleDays.max)
  idleWarnDays!: number;

  @IsInt()
  @Min(stallMinSpanDays.min)
  @Max(stallMinSpanDays.max)
  stallMinSpanDays!: number;

  @IsNumber()
  @Min(stallMaxChangeKg.min)
  @Max(stallMaxChangeKg.max)
  stallMaxChangeKg!: number;
}
