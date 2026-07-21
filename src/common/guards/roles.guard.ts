import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const roles = this.reflector.get<string[]>('roles', context.getHandler());
    if (!roles) {
      return true;
    }
    interface RequestWithUser {
      user?: { roles?: string[] };
      [key: string]: any;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    const hasAccess = !!(
      user &&
      user.roles &&
      roles.some((role) => user.roles && user.roles.includes(role))
    );

    // Only denials are noteworthy; success is the common path
    if (!hasAccess) {
      this.logger.warn(
        `Denied ${context.getClass().name}.${context.getHandler().name}: requires [${roles.join(', ')}]`,
      );
    }

    return hasAccess;
  }
}
