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
  check() {
    // mongoose readyState: 1 = connected
    const dbConnected = this.connection.readyState === 1;

    return {
      status: dbConnected ? 'ok' : 'degraded',
      database: dbConnected ? 'connected' : 'disconnected',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
