import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CalendarSyncService } from './calendar-sync.service';

@Injectable()
export class CalendarSyncScheduler {
  private readonly logger = new Logger(CalendarSyncScheduler.name);

  constructor(private readonly calendarSyncService: CalendarSyncService) {}

  /**
   * Runs at the 1st of every month at 02:00 AM.
   * Syncs all connected users' active training plans to Google Calendar
   * for the current month's weeks.
   */
  @Cron('0 2 1 * *', { name: 'monthly-google-calendar-sync' })
  async handleMonthlySyncCron() {
    this.logger.log(
      'Starting monthly Google Calendar sync for all connected users...',
    );

    try {
      const result = await this.calendarSyncService.syncAllConnectedUsers();
      this.logger.log(
        `Monthly sync completed — Total: ${result.total}, Succeeded: ${result.succeeded}, Failed: ${result.failed}`,
      );
    } catch (error) {
      this.logger.error('Monthly Google Calendar sync failed:', error);
    }
  }
}
