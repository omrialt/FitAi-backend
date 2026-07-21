/**
 * A Google Calendar event boundary.
 *
 * Google sets EITHER `dateTime` (a timed event) or `date` (an all-day event,
 * as 'YYYY-MM-DD') — never both. Modelling `dateTime` as always-present is what
 * hid the all-day bug: `event.start.dateTime ?? ''` type-checked cleanly but
 * produced `parseISO('')` — an Invalid Date — for every all-day event, which
 * serialized to `null` and vanished from the calendar UI. Both forms are
 * optional here so the compiler forces call sites to handle each one.
 *
 * Note `end.date` on an all-day event is EXCLUSIVE: a single-day event on the
 * 19th has `end.date === '2026-07-20'`.
 */
export interface CalendarEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: CalendarEventTime;
  end: CalendarEventTime;
  extendedProperties?: {
    private?: {
      trainingPlanId?: string;
      exerciseDay?: string;
      eventKey?: string;
      syncedFromFitAi?: string;
    };
  };
}
