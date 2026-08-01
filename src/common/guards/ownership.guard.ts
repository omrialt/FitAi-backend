import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OWNS_USER_PARAM_KEY } from '../decorators/owns-user-param.decorator';

interface RequestWithUser {
  user?: { id?: string; role?: string };
  params?: Record<string, string>;
}

/**
 * Object-level authorization for routes that take a user id from the URL.
 *
 * Routes opt in with `@OwnsUserParam('userId')`; routes without the decorator
 * are left alone, so this guard is safe to mount alongside `RolesGuard`
 * everywhere. Admins pass through — they are the intended cross-user role.
 */
@Injectable()
export class UserOwnershipGuard implements CanActivate {
  private readonly logger = new Logger(UserOwnershipGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const paramName = this.reflector.get<string | undefined>(
      OWNS_USER_PARAM_KEY,
      context.getHandler(),
    );
    if (!paramName) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user?.id) {
      throw new ForbiddenException('Not authenticated');
    }
    if (user.role === 'admin') {
      return true;
    }

    const target = request.params?.[paramName];
    if (target && target === user.id) {
      return true;
    }

    // Log the attempt but never echo the target id back to the caller, so the
    // response cannot be used to probe which ids exist.
    this.logger.warn(
      `Denied ${context.getClass().name}.${context.getHandler().name}: ` +
        `user ${user.id} requested ${paramName} ${target ?? '(missing)'}`,
    );
    throw new ForbiddenException('You can only access your own data');
  }
}
