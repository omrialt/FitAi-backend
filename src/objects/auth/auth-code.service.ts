import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import type { AuthCode } from './auth-code.schema';

/** What a redeemed code resolves to. Never includes the code itself. */
export interface RedeemedAuthCode {
  userId: string;
  needsProfile: boolean;
}

/**
 * Issues and redeems the one-time codes that carry a Google sign-in from the
 * backend redirect to the frontend, in place of putting tokens in the URL.
 */
@Injectable()
export class AuthCodeService {
  /** Long enough for the round trip, short enough that a leaked URL is stale. */
  private static readonly TTL_MS = 2 * 60 * 1000;

  constructor(
    @InjectModel('AuthCode')
    private readonly authCodeModel: Model<AuthCode>,
  ) {}

  /** Mint a code for `userId` and return the plaintext exactly once. */
  async issue(userId: string, needsProfile: boolean): Promise<string> {
    const code = randomBytes(32).toString('hex');

    await this.authCodeModel.create({
      codeHash: AuthCodeService.hash(code),
      userId,
      needsProfile,
      expiresAt: new Date(Date.now() + AuthCodeService.TTL_MS),
    });

    return code;
  }

  /**
   * Redeem a code, or return `null` if it is unknown, already used or expired.
   *
   * `findOneAndDelete` is what makes it single-use: two concurrent redemptions
   * of the same code cannot both match, so the second gets `null` rather than
   * a second set of tokens.
   */
  async redeem(code: string): Promise<RedeemedAuthCode | null> {
    const doc = await this.authCodeModel
      .findOneAndDelete({
        codeHash: AuthCodeService.hash(code),
        expiresAt: { $gt: new Date() },
      })
      .exec();

    if (!doc) {
      return null;
    }

    return { userId: doc.userId, needsProfile: doc.needsProfile };
  }

  private static hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
