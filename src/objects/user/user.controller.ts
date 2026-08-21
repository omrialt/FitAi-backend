import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from './user.service';
// Value imports: these DTOs already carried class-validator decorators, but the
// type-only import erased them, so neither endpoint was ever validated.
import { CreateUserDto, UpdateUserDto } from '../../interfaces/user.interfaces';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AccountService } from '../account/account.service';

/**
 * Fields on UpdateUserDto that decide what an account *is*, rather than what it
 * looks like. Letting a self-service PATCH carry these would turn "edit my
 * profile" into "make myself an admin", so they are dropped for anyone who is
 * not one already.
 */
const ADMIN_ONLY_FIELDS = ['role', 'isActive', 'emailVerified'] as const;

/**
 * Drops everything a user must not be able to set on themselves, returning a
 * copy so the caller's DTO is left alone.
 */
function stripSelfServiceFields(dto: UpdateUserDto): UpdateUserDto {
  const payload = { ...dto };
  for (const field of ADMIN_ONLY_FIELDS) {
    delete payload[field];
  }
  // Password changes go through /auth/change-password, which verifies the
  // current password first; allowing one here would skip that check.
  delete payload.password;
  return payload;
}

/**
 * Rejects a path parameter Mongo cannot read as an id.
 *
 * Without this, anything that is not 24 hex characters reaches
 * `findById` and surfaces as a 500 from a CastError — which is how the missing
 * `me` route showed up in the first place. A malformed id is the caller's
 * mistake, so it should read as 400, and the next literal route someone
 * forgets to register should say so plainly instead of looking like an outage.
 */
function assertObjectId(id: string): void {
  if (!isValidObjectId(id)) {
    throw new BadRequestException(`"${id}" is not a valid user id`);
  }
}

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly accountService: AccountService,
  ) {}

  @Post()
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get()
  @Roles('user', 'trainer', 'admin')
  findAll() {
    return this.userService.findAll();
  }

  /**
   * The caller's own profile.
   *
   * Registered *above* `:id` on purpose. Nest matches routes in declaration
   * order, so a literal segment placed after a parameterised one never runs —
   * `@Get(':id')` would swallow `/users/me` with `id = "me"`, and Mongo cannot
   * cast "me" to an ObjectId, so the request died as a 500. The frontend has
   * been calling `PATCH /users/me` all along; this is the route it expected.
   */
  @Get('me')
  @Roles('user', 'trainer', 'admin')
  findMe(@Request() req: AuthRequest) {
    return this.userService.findOne(req.user.id);
  }

  @Patch('me')
  @Roles('user', 'trainer', 'admin')
  updateMe(@Body() updateUserDto: UpdateUserDto, @Request() req: AuthRequest) {
    // Always self-service, whoever the caller is: an admin editing "me" is
    // still editing their own row, so the same field stripping applies. The
    // escalation path an admin does have stays where it was, on `:id`.
    return this.userService.update(
      req.user.id,
      stripSelfServiceFields(updateUserDto),
    );
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  findOne(@Param('id') id: string) {
    assertObjectId(id);
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @Roles('user', 'trainer', 'admin')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: AuthRequest,
  ) {
    assertObjectId(id);

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && id !== req.user.id) {
      throw new ForbiddenException('You can only update your own profile');
    }

    const payload = isAdmin
      ? updateUserDto
      : stripSelfServiceFields(updateUserDto);

    return this.userService.update(id, payload);
  }

  /**
   * Deletes the user *and everything belonging to them*.
   *
   * This used to be a bare `findByIdAndDelete` on the users collection, which
   * removed the account and left its training plans, nutrition plans,
   * measurements, sessions, progress stats and trainer connections behind —
   * health data with no account to explain whose it was, and dangling
   * references that populate to null. It now runs the same cascade as
   * self-service deletion.
   */
  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    assertObjectId(id);
    return this.accountService.deleteAccount(id);
  }
}
