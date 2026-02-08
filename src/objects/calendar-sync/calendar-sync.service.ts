import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GoogleCalendarService,
  CalendarEvent,
} from '../../common/google-calendar/google-calendar.service';
import { TrainingPlanDocument } from '../training-plan/training-plan.schema';
import { UserDocument } from '../user/user.schema';
import { addDays, startOfWeek, endOfWeek, format, parseISO } from 'date-fns';
import { getIdString } from '../../utils/helpers';

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

@Injectable()
export class CalendarSyncService {
  constructor(
    @InjectModel('TrainingPlan')
    private trainingPlanModel: Model<TrainingPlanDocument>,
    @InjectModel('User')
    private userModel: Model<UserDocument>,
    private googleCalendarService: GoogleCalendarService,
  ) {}

  /**
   * Get merged calendar view (training + Google Calendar events)
   */
  async getWeeklyCalendar(
    userId: string,
    weekStart?: Date,
  ): Promise<SyncedCalendarEvent[]> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Default to current week if not specified
    const start = weekStart
      ? startOfWeek(weekStart, { weekStartsOn: 0 })
      : startOfWeek(new Date(), { weekStartsOn: 0 });
    const end = endOfWeek(start, { weekStartsOn: 0 });

    // Get active training plan
    const activePlan = await this.trainingPlanModel
      .findOne({ userId, isActive: true })
      .exec();

    const trainingEvents: SyncedCalendarEvent[] = [];

    // Generate training events from active plan
    if (activePlan) {
      trainingEvents.push(
        ...this.generateTrainingEvents(activePlan, start, end),
      );
    }

    // Fetch Google Calendar events if user has connected
    let googleEvents: SyncedCalendarEvent[] = [];
    if (user.googleCalendar?.accessToken) {
      if (!user.googleCalendar.refreshToken) {
        throw new NotFoundException('Google Calendar refresh token not found');
      }
      googleEvents = await this.fetchGoogleEvents(
        user.googleCalendar.accessToken,
        user.googleCalendar.refreshToken,
        start,
        end,
      );
    }

    // Merge and sort all events
    const allEvents = [...trainingEvents, ...googleEvents].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );

    return allEvents;
  }

  /**
   * Generate training events from a training plan
   */
  private generateTrainingEvents(
    plan: TrainingPlanDocument,
    startDate: Date,
    endDate: Date,
  ): SyncedCalendarEvent[] {
    const events: SyncedCalendarEvent[] = [];
    const planId = getIdString(plan._id);

    if (plan.programType === 'fixedDays') {
      // Fixed days program - map to specific days of week
      plan.days.forEach((day, dayIndex) => {
        const dayOfWeek = day.dayOfWeek; // 0 = Sunday, 6 = Saturday
        let currentDate = startOfWeek(startDate, { weekStartsOn: 0 });

        // Add dayOfWeek to get the specific day
        currentDate = addDays(currentDate, dayOfWeek);

        if (currentDate >= startDate && currentDate <= endDate) {
          const estimatedDuration = plan.estimatedDuration || 60; // Default 60 minutes
          const startTime = new Date(currentDate);
          startTime.setHours(9, 0, 0, 0); // Default 9 AM

          const endTime = new Date(startTime);
          endTime.setMinutes(endTime.getMinutes() + estimatedDuration);

          events.push({
            title: day.dayName || `Training Day ${dayIndex + 1}`,
            start: startTime,
            end: endTime,
            description: this.generateWorkoutDescription(day.exercises),
            type: 'training',
            trainingPlanId: planId,
            dayIndex,
            exercises: day.exercises,
          });
        }
      });
    } else if (plan.programType === 'rotation') {
      // Rotation program - cycle through days
      const cycleLength = plan.rotationCycleLength || plan.days.length;
      let currentDate = new Date(startDate);
      let dayIndex = 0;

      while (currentDate <= endDate) {
        const day = plan.days[dayIndex % plan.days.length];
        const estimatedDuration = plan.estimatedDuration || 60;
        const startTime = new Date(currentDate);
        startTime.setHours(9, 0, 0, 0);

        const endTime = new Date(startTime);
        endTime.setMinutes(endTime.getMinutes() + estimatedDuration);

        events.push({
          title: day.dayName || `Training Day ${dayIndex + 1}`,
          start: startTime,
          end: endTime,
          description: this.generateWorkoutDescription(day.exercises),
          type: 'training',
          trainingPlanId: planId,
          dayIndex: dayIndex % plan.days.length,
          exercises: day.exercises,
        });

        currentDate = addDays(currentDate, 1);
        dayIndex++;

        // Reset after cycle completion
        if (dayIndex >= cycleLength) {
          dayIndex = 0;
        }
      }
    }

    return events;
  }

  /**
   * Generate workout description from exercises
   */
  private generateWorkoutDescription(
    exercises: { name: string; muscleGroup: string }[],
  ): string {
    if (!exercises || exercises.length === 0) return 'No exercises';

    return exercises
      .map((ex, idx) => `${idx + 1}. ${ex.name} (${ex.muscleGroup})`)
      .join('\n');
  }

  /**
   * Fetch Google Calendar events
   */
  private async fetchGoogleEvents(
    accessToken: string,
    refreshToken: string,
    startDate: Date,
    endDate: Date,
  ): Promise<SyncedCalendarEvent[]> {
    try {
      const events = await this.googleCalendarService.listEvents(
        accessToken,
        refreshToken,
        startDate.toISOString(),
        endDate.toISOString(),
      );

      return events
        .filter(
          (event: CalendarEvent) =>
            !event.extendedProperties?.private?.syncedFromFitAi, // Exclude FitAi synced events
        )
        .map((event: CalendarEvent) => ({
          id: event.id,
          title: event.summary || 'Untitled Event',
          start: parseISO(event.start.dateTime ?? ''),
          end: parseISO(event.end.dateTime ?? ''),
          description: event.description,
          type: 'google' as const,
          googleEventId: event.id,
        }));
    } catch (error) {
      console.error('Error fetching Google Calendar events:', error);
      return [];
    }
  }

  /**
   * Sync training plan to Google Calendar
   */
  async syncTrainingPlanToGoogle(
    userId: string,
    trainingPlanId: string,
    weekStart?: Date,
  ): Promise<{ created: number; updated: number; deleted: number }> {
    const user = await this.userModel.findById(userId).exec();
    if (!user || !user.googleCalendar?.accessToken) {
      throw new NotFoundException(
        'User not found or Google Calendar not connected',
      );
    }

    if (!user.googleCalendar.refreshToken) {
      throw new NotFoundException('Google Calendar refresh token not found');
    }

    const plan = await this.trainingPlanModel.findById(trainingPlanId).exec();
    if (!plan) {
      throw new NotFoundException('Training plan not found');
    }

    const start = weekStart
      ? startOfWeek(weekStart, { weekStartsOn: 0 })
      : startOfWeek(new Date(), { weekStartsOn: 0 });
    const end = endOfWeek(start, { weekStartsOn: 0 });

    // Generate training events
    const trainingEvents = this.generateTrainingEvents(plan, start, end);

    // Find existing synced events in Google Calendar
    const existingSyncedEvents =
      (await this.googleCalendarService.findSyncedEvents(
        user.googleCalendar.accessToken,
        user.googleCalendar.refreshToken,
        trainingPlanId,
        start.toISOString(),
        end.toISOString(),
      )) as CalendarEvent[];

    let created = 0;
    let updated = 0;
    let deleted = 0;

    // Create or update events
    for (const trainingEvent of trainingEvents) {
      const existingEvent = existingSyncedEvents.find(
        (e) =>
          e.extendedProperties?.private?.exerciseDay ===
          trainingEvent.dayIndex?.toString(),
      );

      const calendarEvent: CalendarEvent = {
        summary: `🏋️ ${trainingEvent.title}`,
        description: trainingEvent.description,
        start: {
          dateTime: trainingEvent.start.toISOString(),
          timeZone: user.timezone || 'UTC',
        },
        end: {
          dateTime: trainingEvent.end.toISOString(),
          timeZone: user.timezone || 'UTC',
        },
        extendedProperties: {
          private: {
            trainingPlanId,
            exerciseDay: trainingEvent.dayIndex?.toString(),
            syncedFromFitAi: 'true',
          },
        },
      };

      if (existingEvent && existingEvent.id) {
        // Update existing event
        await this.googleCalendarService.updateEvent(
          user.googleCalendar.accessToken,
          user.googleCalendar.refreshToken,
          existingEvent.id,
          calendarEvent,
        );
        updated++;
      } else {
        // Create new event
        await this.googleCalendarService.createEvent(
          user.googleCalendar.accessToken,
          user.googleCalendar.refreshToken,
          calendarEvent,
        );
        created++;
      }
    }

    // Delete events that no longer exist in training plan
    const trainingDayIndices = new Set(
      trainingEvents.map((e) => e.dayIndex?.toString()),
    );
    for (const existingEvent of existingSyncedEvents) {
      const dayIndex = existingEvent.extendedProperties?.private?.exerciseDay;
      if (!trainingDayIndices.has(dayIndex) && existingEvent.id) {
        await this.googleCalendarService.deleteEvent(
          user.googleCalendar.accessToken,
          user.googleCalendar.refreshToken,
          existingEvent.id,
        );
        deleted++;
      }
    }

    return { created, updated, deleted };
  }

  /**
   * Disconnect Google Calendar
   */
  async disconnectGoogleCalendar(userId: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(userId, {
        $unset: { googleCalendar: '' },
      })
      .exec();
  }
}
