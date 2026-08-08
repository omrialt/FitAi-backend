import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  OWNS_USER_PARAM_KEY,
  type OwnsUserParamMetadata,
} from '../decorators/owns-user-param.decorator';
import { TrainerAccessService } from '../trainer-access/trainer-access.service';

interface RequestWithUser {
  user?: { id?: string; role?: string };
  params?: Record<string, string>;
  method?: string;
}

/** Methods that only read. A trainer's access stops at this line. */
const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Object-level authorization for routes that take a user id from the URL.
 *
 * Routes opt in with `@OwnsUserParam('userId')`; routes without the decorator
 * are left alone, so this guard is safe to mount alongside `RolesGuard`
 * everywhere.
 *
 * Three ways past it:
 *   - the id is your own;
 *   - you are an admin, the intended cross-user role;
 *   - you are a trainer reading a client who accepted your invite.
 *
 * The trainer path is what turns an accepted connection into actual access.
 * Before it, accepting an invite only wrote `User.trainerId`, a field no
 * permission check ever read, so a coach still saw nothing belonging to their
 * own client.
 */
@Injectable()
export class UserOwnershipGuard implements CanActivate {
  private readonly logger = new Logger(UserOwnershipGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly trainerAccess: TrainerAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<OwnsUserParamMetadata | undefined>(
      OWNS_USER_PARAM_KEY,
      context.getHandler(),
    );
    if (!rule) {
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

    const target = request.params?.[rule.param];
    if (target && target === user.id) {
      return true;
    }

    if (
      target &&
      rule.allowTrainer &&
      user.role === 'trainer' &&
      READ_METHODS.has(request.method ?? '') &&
      (await this.trainerAccess.isAcceptedTrainerOf(user.id, target))
    ) {
      return true;
    }

    // Log the attempt but never echo the target id back to the caller, so the
    // response cannot be used to probe which ids exist.
    this.logger.warn(
      `Denied ${context.getClass().name}.${context.getHandler().name}: ` +
        `user ${user.id} requested ${rule.param} ${target ?? '(missing)'}`,
    );
    throw new ForbiddenException('You can only access your own data');
  }
}
