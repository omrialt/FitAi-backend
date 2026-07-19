import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtPayload, AuthRequest } from '../../interfaces/jwt.interfaces';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @InjectModel('User') private readonly userModel: Model<any>,
    @Inject('TokenBlacklistService')
    private readonly tokenBlacklistService?: {
      isBlacklisted: (token: string) => Promise<boolean>;
    },
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('🔐 JwtAuthGuard: No token provided');
      throw new UnauthorizedException('No token provided');
    }

    const token = authHeader.substring(7);

    // Check if token is blacklisted
    if (this.tokenBlacklistService) {
      const isBlacklisted =
        await this.tokenBlacklistService.isBlacklisted(token);
      if (isBlacklisted) {
        console.log('🔐 JwtAuthGuard: Token is blacklisted');
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    try {
      const secret = process.env.JWT_ACCESS_SECRET!;
      const payload = jwt.verify(token, secret) as JwtPayload;

      // Fetch user from database to get role (or use from token if available)

      let role = payload.role;

      // If role not in token, fetch from database
      if (!role) {
        const user = (await this.userModel
          .findById(payload.userId)
          .select('role')
          .lean()
          .exec()) as { role: string } | null;

        if (!user) {
          throw new UnauthorizedException('User not found');
        }

        role = user.role;
      }

      // Attach user info to request
      request.user = {
        id: payload.userId,
        email: payload.email,
        role,
        roles: [role], // For RolesGuard compatibility
      };

      return true;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        console.log('🔐 JwtAuthGuard: Invalid token error');
        throw new UnauthorizedException('Invalid token');
      }
      if (error instanceof jwt.TokenExpiredError) {
        console.log('🔐 JwtAuthGuard: Token expired error');
        throw new UnauthorizedException('Token expired');
      }
      console.log('🔐 JwtAuthGuard: Unexpected error:', error);
      throw error;
    }
  }
}
