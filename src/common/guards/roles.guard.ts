import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const roles = this.reflector.get<string[]>('roles', context.getHandler());
    console.log('🛡️ RolesGuard: Required roles:', roles);
    if (!roles) {
      console.log('🛡️ RolesGuard: No roles required, allowing access');
      return true;
    }
    interface RequestWithUser {
      user?: { roles?: string[] };
      [key: string]: any;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    console.log('🛡️ RolesGuard: User from request:', user);

    const hasAccess = !!(
      user &&
      user.roles &&
      roles.some((role) => user.roles && user.roles.includes(role))
    );

    console.log('🛡️ RolesGuard: Access granted:', hasAccess);
    return hasAccess;
  }
}
