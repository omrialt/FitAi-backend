export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  extendedProperties?: {
    private?: {
      trainingPlanId?: string;
      exerciseDay?: string;
      eventKey?: string;
      syncedFromFitAi?: string;
    };
  };
}
