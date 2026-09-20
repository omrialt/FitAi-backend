import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import { MessageService } from './message.service';
import { MAX_MESSAGE_LENGTH } from './message.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

const sendBodySchema = z.object({
  toUserId: z.string().min(1, 'toUserId is required'),
  body: z
    .string()
    .trim()
    .min(1, 'A message cannot be empty')
    .max(MAX_MESSAGE_LENGTH, 'That message is too long'),
});
type SendBody = z.infer<typeof sendBodySchema>;

/**
 * Every route is open to every role, and none of them is authorized by role:
 * whether these two people may talk is decided by the connection between them,
 * inside the service. A `@Roles('trainer')` here would be a lie — the client
 * side of the conversation has role `user`.
 *
 * `unread-count` and `threads` are declared above `:otherUserId` so Nest, which
 * registers routes in declaration order, does not read them as user ids.
 */
@Controller('messages')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class MessageController {
  constructor(private readonly service: MessageService) {}

  @Get('threads')
  @Roles('user', 'trainer', 'admin')
  async threads(@Request() req: AuthRequest) {
    return this.service.listThreads(req.user.id);
  }

  @Get('unread-count')
  @Roles('user', 'trainer', 'admin')
  async unreadCount(@Request() req: AuthRequest) {
    return this.service.unreadCount(req.user.id);
  }

  @Post()
  @Roles('user', 'trainer', 'admin')
  async send(
    @Body(new ZodValidationPipe(sendBodySchema)) body: SendBody,
    @Request() req: AuthRequest,
  ) {
    return this.service.send(req.user.id, body.toUserId, body.body);
  }

  @Get(':otherUserId')
  @Roles('user', 'trainer', 'admin')
  async thread(
    @Param('otherUserId') otherUserId: string,
    @Request() req: AuthRequest,
    @Query('after') after?: string,
  ) {
    return this.service.getThread(req.user.id, otherUserId, after);
  }

  @Patch(':otherUserId/read')
  @Roles('user', 'trainer', 'admin')
  async markRead(
    @Param('otherUserId') otherUserId: string,
    @Request() req: AuthRequest,
  ) {
    return this.service.markRead(req.user.id, otherUserId);
  }
}
