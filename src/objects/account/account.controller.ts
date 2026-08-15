import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Header,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { AccountService, type DeletionReport } from './account.service';

/**
 * Confirmation for an irreversible action. Which field is required depends on
 * how the account signs in, so both are optional here and the service decides.
 */
const deleteAccountBodySchema = z.object({
  password: z.string().optional(),
  email: z.string().optional(),
});

/**
 * Data-subject operations, scoped to the caller.
 *
 * Every route here acts on `req.user.id` and never takes an id from the URL.
 * That is the whole authorization story: there is no parameter to tamper with,
 * so no ownership guard to forget. An admin deleting *someone else's* account
 * stays where it already was, on `DELETE /users/:id`.
 */
@ApiTags('account')
@Controller('account')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('export')
  @Roles('user', 'trainer', 'admin')
  @ApiOperation({ summary: 'Download everything stored about this account' })
  // Prompts a download rather than rendering in the tab; the body is the
  // person's health history and does not belong in browser history or cache.
  @Header('Content-Disposition', 'attachment; filename="fitai-export.json"')
  @Header('Cache-Control', 'no-store')
  // The saved file must be the export and nothing else — see the decorator.
  @RawResponse()
  async exportOwnData(
    @Request() req: AuthRequest,
  ): Promise<Record<string, unknown>> {
    return this.accountService.exportUserData(req.user.id);
  }

  @Delete()
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Permanently delete this account and all its data' })
  async deleteOwnAccount(
    @Body(new ZodValidationPipe(deleteAccountBodySchema))
    body: { password?: string; email?: string },
    @Request() req: AuthRequest,
  ): Promise<DeletionReport> {
    // Re-authenticate first: a 15-minute access token on an unattended laptop
    // must not be enough to erase someone's account.
    await this.accountService.assertDeletionConfirmed(req.user.id, body);

    // Returns the report rather than 204. Someone asking to be erased should
    // be able to see what was erased.
    return this.accountService.deleteAccount(req.user.id);
  }
}
