import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

import { hasSharedRateLimitStore } from '../middleware/upstash-rate-limit.store';
import { readUpstashCredentials } from '../upstash/upstash-kv';

/**
 * Liveness/readiness probe.
 *
 * Render (and most hosts) poll a path to decide whether an instance is healthy
 * and whether a deploy succeeded. Without this the probe would hit `/`, which
 * this API does not serve, and every deploy would look unhealthy.
 *
 * Deliberately unauthenticated and free of detail — it reports whether the
 * process is up, whether Mongo is connected, and which of two optional
 * subsystems are actually sharing state. Nothing here is useful to an
 * unauthenticated caller: they are booleans about this deployment's own
 * configuration, not about any user, and none of them name a host or a key.
 *
 * The `shared` block exists because of a failure mode this project has now
 * hit twice. N-04 shipped a distributed rate-limit store and then deployed
 * without the two Upstash variables, so the ceiling stayed per-lambda while
 * every test, every log line and every code review said "shared". Alert
 * de-duplication had the same shape. Code that degrades silently to a no-op
 * is code where "deployed" and "in effect" are separate facts, and the only
 * honest fix is to publish the second one somewhere a human can read without
 * a deploy log.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe with database connectivity' })
  async check() {
    // `readyState` is the driver's belief about the socket; it stays at 1 for a
    // while after the server stops answering. A ping is the only thing that
    // asks the database itself, and a health check that reports "connected"
    // through an outage is worse than none.
    //
    // The response keys are unchanged — external checks already read `status`
    // and `database` — but `database` is now earned rather than assumed.
    // mongoose ConnectionStates.connected — compared as a number because the
    // driver types readyState as its own enum.
    const CONNECTED = 1;
    let dbConnected = Number(this.connection.readyState) === CONNECTED;

    if (dbConnected) {
      try {
        await this.connection.db?.admin().ping();
      } catch {
        dbConnected = false;
      }
    }

    // Not folded into `status`: running with per-instance counters is a
    // deliberate, supported configuration, not a degraded one. Reporting it
    // as unhealthy would train whoever watches this endpoint to ignore it.
    const upstash = readUpstashCredentials() !== null;

    return {
      status: dbConnected ? 'ok' : 'degraded',
      database: dbConnected ? 'connected' : 'disconnected',
      shared: {
        rateLimit: hasSharedRateLimitStore(),
        alertDeduplication: upstash,
      },
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
