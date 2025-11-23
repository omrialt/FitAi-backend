import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtPayload } from '../interfaces/auth.interfaces';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@InjectModel('User') private readonly userModel: Model<any>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'access-secret',
    });
  }

  async validate(payload: JwtPayload) {
    console.log('🔐 JwtStrategy: Validating token payload:', payload);

    // If role is in payload, use it directly (faster)
    if (payload.role) {
      const user = {
        id: payload.userId,
        email: payload.email,
        role: payload.role,
        roles: [payload.role],
      };
      console.log('🔐 JwtStrategy: User validated from token:', user);
      return user;
    }

    // Otherwise fetch from database
    const dbUser = await this.userModel
      .findById(payload.userId)
      .select('_id email role')
      .lean()
      .exec();

    if (!dbUser) {
      console.log('🔐 JwtStrategy: User not found');
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

    console.log('🔐 JwtStrategy: User validated from database:', validatedUser);
    return validatedUser;
  }
}
