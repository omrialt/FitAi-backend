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
  ForbiddenException,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserService } from './user.service';
// Value imports: these DTOs already carried class-validator decorators, but the
// type-only import erased them, so neither endpoint was ever validated.
import { CreateUserDto, UpdateUserDto } from '../../interfaces/user.interfaces';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Fields on UpdateUserDto that decide what an account *is*, rather than what it
 * looks like. Letting a self-service PATCH carry these would turn "edit my
 * profile" into "make myself an admin", so they are dropped for anyone who is
 * not one already.
 */
const ADMIN_ONLY_FIELDS = ['role', 'isActive', 'emailVerified'] as const;

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

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

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @Roles('user', 'trainer', 'admin')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: AuthRequest,
  ) {
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && id !== req.user.id) {
      throw new ForbiddenException('You can only update your own profile');
    }

    let payload = updateUserDto;
    if (!isAdmin) {
      payload = { ...updateUserDto };
      for (const field of ADMIN_ONLY_FIELDS) {
        delete payload[field];
      }
      // Password changes go through /auth/change-password, which verifies the
      // current password first; allowing one here would skip that check.
      delete payload.password;
    }

    return this.userService.update(id, payload);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}
