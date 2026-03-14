export interface SyncedCalendarEvent {
  id?: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  type: 'training' | 'google';
  trainingPlanId?: string;
  dayIndex?: number;
  googleEventId?: string;
  exercises?: any[];
}
