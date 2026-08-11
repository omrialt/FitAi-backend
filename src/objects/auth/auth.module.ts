import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserSchema } from '../user/user.schema';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';
import { NodemailerModule } from 'src/common/nodemailer/nodemailer.module';
import { TokenBlacklistSchema } from './token-blacklist.schema';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshTokenFamilySchema } from './refresh-token-family.schema';
import { RefreshTokenService } from './refresh-token.service';
import { AuthCodeSchema } from './auth-code.schema';
import { AuthCodeService } from './auth-code.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'TokenBlacklist', schema: TokenBlacklistSchema },
      { name: 'RefreshTokenFamily', schema: RefreshTokenFamilySchema },
      { name: 'AuthCode', schema: AuthCodeSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    NodemailerModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenBlacklistService,
    RefreshTokenService,
    AuthCodeService,
    JwtStrategy,
  ],
  exports: [
    AuthService,
    TokenBlacklistService,
    RefreshTokenService,
    JwtStrategy,
    PassportModule,
  ],
})
export class AuthModule {}
