import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtPayload } from '../../interfaces/jwt.interfaces';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(@InjectModel('User') private readonly userModel: Model<any>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET!,
    });
  }

  // Logs identify the subject by id only — payloads and user records carry
  // email and role, which must not be written to stdout on every request.
  async validate(payload: JwtPayload) {
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
