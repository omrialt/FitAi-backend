import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import { PushService } from './push.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

const deviceSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.literal('android'),
});
type DeviceBody = z.infer<typeof deviceSchema>;

const prefsSchema = z
  .object({
    messages: z.boolean().optional(),
    plans: z.boolean().optional(),
    connections: z.boolean().optional(),
  })
  .strict();
type PrefsBody = z.infer<typeof prefsSchema>;

/** Every route acts on the caller only; the user id comes from the token. */
@Controller('push')
@UseGuards(AuthGuard('jwt'))
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(
    @Body(new ZodValidationPipe(deviceSchema)) body: DeviceBody,
    @Request() req: AuthRequest,
  ) {
    await this.push.register(req.user.id, body.token);
  }

  @Delete('devices/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregister(@Param('token') token: string, @Request() req: AuthRequest) {
    await this.push.unregister(req.user.id, token);
  }

  @Get('preferences')
  async getPrefs(@Request() req: AuthRequest) {
    return this.push.getPrefs(req.user.id);
  }

  @Patch('preferences')
  async setPrefs(
    @Body(new ZodValidationPipe(prefsSchema)) body: PrefsBody,
    @Request() req: AuthRequest,
  ) {
    return this.push.setPrefs(req.user.id, body);
  }
}
