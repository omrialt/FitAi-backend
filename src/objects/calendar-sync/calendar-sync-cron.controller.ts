import {
  Controller,
  Get,
  Headers,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CalendarSyncService } from './calendar-sync.service';

/**
 * HTTP-triggered equivalent of CalendarSyncScheduler.
 *
 * Serverless platforms freeze the process between requests, so an in-process
 * @Cron never fires there. Vercel Cron instead issues a normal GET to this
 * route on a schedule; the work itself is identical.
 *
 * The in-process scheduler is still used on long-running hosts — see
 * app.module.ts, which registers only one of the two.
 */
@ApiExcludeController()
@Controller('cron')
export class CalendarSyncCronController {
  private readonly logger = new Logger(CalendarSyncCronController.name);

  constructor(private readonly calendarSyncService: CalendarSyncService) {}

  @Get('calendar-sync')
  async runCalendarSync(
    @Headers('authorization') authorization?: string,
  ): Promise<{ status: string; detail?: string }> {
    // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET
    // is configured. Without this the route would be an unauthenticated way for
    // anyone to trigger a full sync across every connected user.
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      this.logger.error('CRON_SECRET is not set; refusing to run.');
      throw new UnauthorizedException();
    }
    if (authorization !== `Bearer ${secret}`) {
      this.logger.warn('Rejected a cron request with a bad or missing secret.');
      throw new UnauthorizedException();
    }

    // The original schedule was monthly (1st at 02:00). Vercel's Hobby plan
    // only guarantees daily granularity, so this runs daily and returns early
    // on other days — keeping the effective schedule the same.
    const dayOfMonth = new Date().getUTCDate();
    if (dayOfMonth !== 1) {
      return { status: 'skipped', detail: `not the 1st (day ${dayOfMonth})` };
    }

    this.logger.log('Starting monthly Google Calendar sync for all users...');
    try {
      const result = await this.calendarSyncService.syncAllConnectedUsers();
      const detail = `Total: ${result.total}, Succeeded: ${result.succeeded}, Failed: ${result.failed}`;
      this.logger.log(`Monthly sync completed — ${detail}`);
      return { status: 'ok', detail };
    } catch (error) {
      this.logger.error(
        'Monthly Google Calendar sync failed',
        error instanceof Error ? error.stack : String(error),
      );
      return { status: 'error' };
    }
  }
}
