import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * Answers the bare host.
 *
 * Nothing in the app calls `/`, but it is the first thing a person opens to
 * see whether the API is up — and a JSON 404 there reads as an outage even
 * while `/health` is green. This says the process is running and points at
 * the probe that actually checks the database.
 *
 * Static on purpose: no database call, no environment or version detail.
 * Whether the deployment is healthy is `/health`'s question, not this one's.
 */
@ApiTags('health')
@Controller()
export class RootController {
  @Get()
  @ApiOperation({ summary: 'Says the API is running and points to /health' })
  root() {
    return {
      name: 'FitAi API',
      status: 'running',
      health: '/health',
    };
  }
}
