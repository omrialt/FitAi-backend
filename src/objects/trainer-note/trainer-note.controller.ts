import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import { TrainerNoteService } from './trainer-note.service';
import { MAX_NOTE_LENGTH } from './trainer-note.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

const noteBodySchema = z.object({
  body: z.string().max(MAX_NOTE_LENGTH, 'That note is too long'),
});
type NoteBody = z.infer<typeof noteBodySchema>;

/**
 * `@Roles('trainer','admin')` keeps the client role off these routes entirely,
 * and the service then checks the specific pair. The role alone would not be
 * enough — one trainer must not read another trainer's notebook — and the pair
 * check alone would let a client ask for a note about themselves and be
 * refused rather than never reaching the route at all.
 *
 * The trainer id always comes from the token, never from the URL: there is no
 * route here that takes one.
 */
@Controller('trainer-notes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TrainerNoteController {
  constructor(private readonly service: TrainerNoteService) {}

  @Get(':clientId')
  @Roles('trainer', 'admin')
  async get(@Param('clientId') clientId: string, @Request() req: AuthRequest) {
    return this.service.get(req.user.id, clientId);
  }

  @Put(':clientId')
  @Roles('trainer', 'admin')
  async save(
    @Param('clientId') clientId: string,
    @Body(new ZodValidationPipe(noteBodySchema)) body: NoteBody,
    @Request() req: AuthRequest,
  ) {
    return this.service.save(req.user.id, clientId, body.body);
  }
}
