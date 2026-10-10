import { Schema } from 'mongoose';

/**
 * A trainer's own thresholds for the roster alerts.
 *
 * The numbers used to be constants, and they are reasonable defaults — but a
 * coach whose clients train twice a week reads "no session in 7 days" very
 * differently from one whose clients train daily. So the defaults stay where
 * they were, and a trainer who disagrees can say so once.
 *
 * Its own collection rather than fields on `User`: it is one trainer's
 * preference about one screen, and nothing else that loads a user needs it.
 * A trainer who never opens the settings has no document at all.
 */
export interface TrainerAlertSettings {
  /** No session in this many days is worth mentioning… */
  idleInfoDays: number;
  /** …and in this many, worth acting on. */
  idleWarnDays: number;
  /** Weight is only called "stalled" over a span at least this long. */
  stallMinSpanDays: number;
  /** Movement smaller than this over that span is noise, not progress. */
  stallMaxChangeKg: number;
}

export const DEFAULT_ALERT_SETTINGS: TrainerAlertSettings = {
  idleInfoDays: 7,
  idleWarnDays: 10,
  stallMinSpanDays: 21,
  stallMaxChangeKg: 0.5,
};

/** Bounds shared by the DTO and the schema, so they cannot drift apart. */
export const ALERT_SETTING_BOUNDS = {
  idleDays: { min: 1, max: 60 },
  // The weight window the roster reads is 56 days; a longer span could never
  // be satisfied, and the alert would silently stop existing.
  stallMinSpanDays: { min: 7, max: 56 },
  stallMaxChangeKg: { min: 0.1, max: 5 },
} as const;

export const TrainerAlertSettingsSchema = new Schema(
  {
    trainerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    idleInfoDays: {
      type: Number,
      required: true,
      min: ALERT_SETTING_BOUNDS.idleDays.min,
      max: ALERT_SETTING_BOUNDS.idleDays.max,
    },
    idleWarnDays: {
      type: Number,
      required: true,
      min: ALERT_SETTING_BOUNDS.idleDays.min,
      max: ALERT_SETTING_BOUNDS.idleDays.max,
    },
    stallMinSpanDays: {
      type: Number,
      required: true,
      min: ALERT_SETTING_BOUNDS.stallMinSpanDays.min,
      max: ALERT_SETTING_BOUNDS.stallMinSpanDays.max,
    },
    stallMaxChangeKg: {
      type: Number,
      required: true,
      min: ALERT_SETTING_BOUNDS.stallMaxChangeKg.min,
      max: ALERT_SETTING_BOUNDS.stallMaxChangeKg.max,
    },
  },
  { timestamps: true },
);
