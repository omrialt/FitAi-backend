import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import { TrainerConnectionService } from './trainer-connection.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

const inviteBodySchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),
});
type InviteBody = z.infer<typeof inviteBodySchema>;

@Controller('trainer-connections')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TrainerConnectionController {
  constructor(private readonly service: TrainerConnectionService) {}

  @Post('invite')
  @Roles('trainer', 'admin')
  async invite(
    @Body(new ZodValidationPipe(inviteBodySchema)) body: InviteBody,
    @Request() req: AuthRequest,
  ) {
    return this.service.invite(req.user.id, body.clientId);
  }

  @Get('clients')
  @Roles('trainer', 'admin')
  async listClients(@Request() req: AuthRequest) {
    return this.service.listClients(req.user.id);
  }

  @Get('my-connections')
  @Roles('user', 'trainer', 'admin')
  async myConnections(@Request() req: AuthRequest) {
    return this.service.listForClient(req.user.id);
  }

  @Patch(':id/accept')
  @Roles('user', 'trainer', 'admin')
  async accept(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.accept(id, req.user.id);
  }

  @Patch(':id/decline')
  @Roles('user', 'trainer', 'admin')
  async decline(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.decline(id, req.user.id);
  }

  @Delete(':id')
  @Roles('user', 'trainer', 'admin')
  async remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.remove(id, req.user.id);
  }
}
