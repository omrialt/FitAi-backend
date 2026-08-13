import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

/**
 * Liveness/readiness probe.
 *
 * Render (and most hosts) poll a path to decide whether an instance is healthy
 * and whether a deploy succeeded. Without this the probe would hit `/`, which
 * this API does not serve, and every deploy would look unhealthy.
 *
 * Deliberately unauthenticated and free of detail — it reports whether the
 * process is up and whether Mongo is connected, nothing that would be useful
 * to an unauthenticated caller.
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

    return {
      status: dbConnected ? 'ok' : 'degraded',
      database: dbConnected ? 'connected' : 'disconnected',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
