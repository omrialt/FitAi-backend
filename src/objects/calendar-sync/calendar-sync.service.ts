import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GoogleCalendarService,
} from '../../common/google-calendar/google-calendar.service';
import { CalendarEvent } from '../../interfaces/calendar.interfaces';
import { SyncedCalendarEvent } from '../../interfaces/calendar-sync.interfaces';
import { TrainingPlanDocument } from '../training-plan/training-plan.schema';
import { UserDocument } from '../user/user.schema';
import {
  addDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  parseISO,
  format,
} from 'date-fns';
import { getIdString } from '../../utils/helpers';

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
      // Fixed days program - iterate each week in the range
      let weekCursor = startOfWeek(startDate, { weekStartsOn: 0 });

      while (weekCursor <= endDate) {
        plan.days.forEach((day, dayIndex) => {
          const dayOfWeek = day.dayOfWeek; // 0 = Sunday, 6 = Saturday
          const eventDate = addDays(weekCursor, dayOfWeek);

          if (eventDate >= startDate && eventDate <= endDate) {
            const estimatedDuration = plan.estimatedDuration || 60;
            const startTime = new Date(eventDate);
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
              dayIndex,
              exercises: day.exercises,
            });
          }
        });

        weekCursor = addDays(weekCursor, 7);
      }
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
    referenceDate?: Date,
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

    let accessToken = user.googleCalendar.accessToken;
    const refreshToken = user.googleCalendar.refreshToken;
    let expiryDate = user.googleCalendar.expiryDate;
    const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;

    // Only proactively refresh when we KNOW the expiry and it's approaching.
    // If expiryDate is missing, we rely on googleapis auto-refresh (expiry_date
    // is now passed to setCredentials so the library handles it transparently).
    if (expiryDate && expiryDate < fiveMinutesFromNow) {
      try {
        const refreshed =
          await this.googleCalendarService.refreshAccessToken(refreshToken);
        accessToken = refreshed.accessToken;
        expiryDate = refreshed.expiryDate;
        await this.userModel
          .findByIdAndUpdate(userId, {
            $set: {
              'googleCalendar.accessToken': refreshed.accessToken,
              'googleCalendar.expiryDate': refreshed.expiryDate,
            },
          })
          .exec();
      } catch (err) {
        if (
          err instanceof UnauthorizedException &&
          (err.message === 'invalid_grant' ||
            (err as any)?.response?.message === 'invalid_grant')
        ) {
          // Refresh token revoked or expired — disconnect calendar so user reconnects
          await this.userModel
            .findByIdAndUpdate(userId, {
              $set: { 'googleCalendar.connected': false },
            })
            .exec();
          throw new UnauthorizedException(
            'Google Calendar session expired. Please reconnect your Google Calendar.',
          );
        }
        throw err;
      }
    }

    const plan = await this.trainingPlanModel.findById(trainingPlanId).exec();
    if (!plan) {
      throw new NotFoundException('Training plan not found');
    }

    // Sync the full month — from start of first week to end of last week
    // This ensures cross-month coverage (e.g. if month starts on Wed, you get Sun-Sat)
    const refDate = referenceDate ?? new Date();
    const monthStart = startOfMonth(refDate);
    const monthEnd = endOfMonth(refDate);
    const start = startOfWeek(monthStart, { weekStartsOn: 0 });
    const end = endOfWeek(monthEnd, { weekStartsOn: 0 });

    // Generate training events for the entire range
    const trainingEvents = this.generateTrainingEvents(plan, start, end);

    // Find existing synced events in Google Calendar for this range
    const existingSyncedEvents =
      (await this.googleCalendarService.findSyncedEvents(
        accessToken,
        refreshToken,
        trainingPlanId,
        start.toISOString(),
        end.toISOString(),
        expiryDate,
      )) as CalendarEvent[];

    let created = 0;
    let updated = 0;
    let deleted = 0;

    // Use event date + dayIndex as a unique key to avoid collisions across weeks
    const eventKeys = new Set<string>();

    // Create or update events
    for (const trainingEvent of trainingEvents) {
      const eventDateStr = format(trainingEvent.start, 'yyyy-MM-dd');
      const eventKey = `${eventDateStr}_day${trainingEvent.dayIndex}`;
      eventKeys.add(eventKey);

      const existingEvent = existingSyncedEvents.find(
        (e) => e.extendedProperties?.private?.eventKey === eventKey,
      );

      const calendarEvent: CalendarEvent = {
        summary: `🏋️ ${trainingEvent.title}`,
        description: trainingEvent.description
          ? `${trainingEvent.description}\n\n📱 Created with FitAi`
          : '📱 Created with FitAi',
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
            eventKey,
            syncedFromFitAi: 'true',
          },
        },
      };

      if (existingEvent && existingEvent.id) {
        await this.googleCalendarService.updateEvent(
          accessToken,
          refreshToken,
          existingEvent.id,
          calendarEvent,
          expiryDate,
        );
        updated++;
      } else {
        await this.googleCalendarService.createEvent(
          accessToken,
          refreshToken,
          calendarEvent,
          expiryDate,
        );
        created++;
      }
    }

    // Delete events that no longer exist in the training plan for this range
    for (const existingEvent of existingSyncedEvents) {
      const existingKey =
        existingEvent.extendedProperties?.private?.eventKey ?? '';
      if (!existingKey || !eventKeys.has(existingKey)) {
        if (existingEvent.id) {
          await this.googleCalendarService.deleteEvent(
            accessToken,
            refreshToken,
            existingEvent.id,
            expiryDate,
          );
          deleted++;
        }
      }
    }

    return { created, updated, deleted };
  }

  /**
   * Sync all connected users' training plans to Google Calendar.
   * Used by the monthly cron job and can be called manually.
   */
  async syncAllConnectedUsers(): Promise<{
    total: number;
    succeeded: number;
    failed: number;
  }> {
    // Find all users with Google Calendar connected and a refresh token
    const connectedUsers = await this.userModel
      .find({
        'googleCalendar.connected': true,
        'googleCalendar.refreshToken': { $exists: true, $ne: null },
      })
      .exec();

    let succeeded = 0;
    let failed = 0;

    for (const user of connectedUsers) {
      try {
        const userId = getIdString(user._id);

        // Find active training plan for this user
        const activePlan = await this.trainingPlanModel
          .findOne({ userId, isActive: true })
          .exec();

        if (!activePlan) {
          continue; // Skip users without active training plans
        }

        const planId = getIdString(activePlan._id);
        await this.syncTrainingPlanToGoogle(userId, planId);
        succeeded++;
      } catch (error) {
        failed++;
        console.error(
          `Failed to sync Google Calendar for user ${getIdString(user._id)}:`,
          error,
        );
      }
    }

    console.log(
      `Monthly Google Calendar sync complete: ${succeeded} succeeded, ${failed} failed out of ${connectedUsers.length} connected users`,
    );

    return { total: connectedUsers.length, succeeded, failed };
  }

  /**
   * Sync a single user's active training plan to Google Calendar if connected.
   * Fire-and-forget safe — logs errors instead of throwing.
   */
  async syncUserIfConnected(userId: string): Promise<void> {
    try {
      const user = await this.userModel.findById(userId).exec();
      if (
        !user?.googleCalendar?.connected ||
        !user.googleCalendar.accessToken ||
        !user.googleCalendar.refreshToken
      ) {
        return; // Google Calendar not connected — nothing to do
      }

      const activePlan = await this.trainingPlanModel
        .findOne({ userId, isActive: true })
        .exec();

      if (!activePlan) {
        return; // No active plan
      }

      const planId = getIdString(activePlan._id);
      await this.syncTrainingPlanToGoogle(userId, planId);
    } catch (error) {
      console.error(
        `Auto-sync to Google Calendar failed for user ${userId}:`,
        error,
      );
    }
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
