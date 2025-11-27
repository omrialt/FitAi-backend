import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as jwt from 'jsonwebtoken';
import type { TokenBlacklist } from './token-blacklist.schema';

@Injectable()
export class TokenBlacklistService {
  constructor(
    @InjectModel('TokenBlacklist')
    private readonly tokenBlacklistModel: Model<TokenBlacklist>,
  ) {}

  /**
   * Add a token to the blacklist
   * @param token - The JWT token to blacklist
   * @param expiresAt - When the token expires (from JWT payload)
   * @param userId - The user ID associated with the token
   */
  async addToBlacklist(
    token: string,
    expiresAt: Date,
    userId: string,
  ): Promise<void> {
    try {
      await this.tokenBlacklistModel.create({
        token,
        userId,
        expiresAt,
      });
    } catch (error) {
      // Ignore duplicate key errors (token already blacklisted)
      const mongoError = error as { code?: number };
      if (mongoError.code !== 11000) {
        throw error;
      }
    }
  }

  /**
   * Check if a token is blacklisted
   * @param token - The JWT token to check
   * @returns True if the token is blacklisted, false otherwise
   */
  async isBlacklisted(token: string): Promise<boolean> {
    const blacklistedToken = await this.tokenBlacklistModel.findOne({ token });
    return !!blacklistedToken;
  }

  /**
   * Extract expiration date from JWT token
   * @param token - The JWT token
   * @returns The expiration date
   */
  getTokenExpiration(token: string): Date {
    const decoded = jwt.decode(token) as { exp: number } | null;
    if (!decoded || !decoded.exp) {
      // If no expiration, set to 15 minutes from now (default access token expiry)
      return new Date(Date.now() + 15 * 60 * 1000);
    }
    // Convert Unix timestamp to Date
    return new Date(decoded.exp * 1000);
  }

  /**
   * Remove all blacklisted tokens for a specific user
   * Useful when user changes password or for admin actions
   * @param userId - The user ID
   */
  async removeUserTokens(userId: string): Promise<void> {
    await this.tokenBlacklistModel.deleteMany({ userId });
  }

  /**
   * Manually clean up expired tokens (optional, TTL index handles this automatically)
   */
  async cleanupExpiredTokens(): Promise<void> {
    await this.tokenBlacklistModel.deleteMany({
      expiresAt: { $lt: new Date() },
    });
  }
}
