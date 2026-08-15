import {
  Controller,
  Get,
  Headers,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { HealthProbeService, type ProbeResult } from './health-probe.service';

/**
 * Runs the health probes on a schedule.
 *
 * Same shape as the calendar-sync cron and for the same reason: serverless
 * freezes the process between requests, so an in-process @Cron never fires.
 * Vercel Cron issues a GET here instead.
 */
@ApiExcludeController()
@Controller('cron')
export class MonitorCronController {
  private readonly logger = new Logger(MonitorCronController.name);

  constructor(private readonly probes: HealthProbeService) {}

  @Get('monitor')
  async runMonitor(@Headers('authorization') authorization?: string): Promise<{
    status: string;
    checks: ProbeResult[];
  }> {
    // Unauthenticated, this route would tell any caller how many accounts are
    // locked out and how far a migration has got — a free reconnaissance
    // endpoint. Same guard as the other cron route.
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      this.logger.error('CRON_SECRET is not set; refusing to run.');
      throw new UnauthorizedException();
    }
    if (authorization !== `Bearer ${secret}`) {
      this.logger.warn(
        'Rejected a monitor request with a bad or missing secret.',
      );
      throw new UnauthorizedException();
    }

    const checks = await this.probes.runAll();
    const failed = checks.filter((c) => !c.ok);

    return {
      status: failed.length === 0 ? 'ok' : 'degraded',
      checks,
    };
  }
}
