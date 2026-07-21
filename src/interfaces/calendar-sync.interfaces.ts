export interface SyncedCalendarEvent {
  id?: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  type: 'training' | 'google';
  /** True for Google all-day events, which carry a date but no time of day. */
  allDay?: boolean;
  trainingPlanId?: string;
  dayIndex?: number;
  googleEventId?: string;
  exercises?: any[];
}
