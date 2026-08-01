import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Request } from 'express';
import { JwtPayload } from '../../interfaces/jwt.interfaces';
import { TokenBlacklistService } from '../../objects/auth/token-blacklist.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    @InjectModel('User') private readonly userModel: Model<any>,
    // Injected by class, not by the 'TokenBlacklistService' string token: that
    // string provider lives in UserModule, while this strategy is constructed
    // by AuthModule, which provides the class itself.
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET!,
      // Needed to reach the raw bearer token, which is what the blacklist is
      // keyed on. Without it this strategy cannot tell a live token from one
      // that was revoked at logout.
      passReqToCallback: true,
    });
  }

  // Logs identify the subject by id only — payloads and user records carry
  // email and role, which must not be written to stdout on every request.
  async validate(req: Request, payload: JwtPayload) {
    // POST /auth/logout blacklists the access token, but only JwtAuthGuard
    // consulted that list, and JwtAuthGuard covers just two controllers. Every
    // other route in the app authenticates through this strategy, so without
    // this check a "logged out" token kept working until it expired.
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (token && (await this.tokenBlacklistService.isBlacklisted(token))) {
      this.logger.warn(`Rejected a revoked token for ${payload.userId}`);
      throw new UnauthorizedException('Token has been revoked');
    }

    // If role is in payload, use it directly (faster)
    if (payload.role) {
      this.logger.debug(`Validated ${payload.userId} from token claims`);
      return {
        id: payload.userId,
        email: payload.email,
        role: payload.role,
        roles: [payload.role],
      };
    }

    // Otherwise fetch from database
    const dbUser = await this.userModel
      .findById(payload.userId)
      .select('_id email role')
      .lean()
      .exec();

    if (!dbUser) {
      this.logger.warn(`Token referenced unknown user ${payload.userId}`);
      throw new UnauthorizedException('User not found');
    }

    const user = dbUser as unknown as {
      _id: string;
      email: string;
      role: string;
    };

    const validatedUser = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      roles: [user.role],
    };

    this.logger.debug(`Validated ${validatedUser.id} from database`);
    return validatedUser;
  }
}
