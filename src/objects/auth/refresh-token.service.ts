import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import type { RefreshTokenFamily } from './refresh-token-family.schema';

/** Outcome of offering a refresh token's identifiers to the family store. */
export type RotationResult =
  | { status: 'rotated'; nextJti: string }
  | { status: 'replayed' }
  | { status: 'unknown' };

/**
 * Owns the lifecycle of refresh-token families: which token in a chain is
 * currently redeemable, and when a chain must be torn down.
 *
 * Kept separate from `AuthService` because that class is already 650 lines and
 * because the rotation rules are the part worth reading on their own.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    @InjectModel('RefreshTokenFamily')
    private readonly familyModel: Model<RefreshTokenFamily>,
  ) {}

  /** Identifiers for a brand-new session. */
  startFamily(): { familyId: string; jti: string } {
    return { familyId: randomUUID(), jti: randomUUID() };
  }

  /** Record a new session so its first refresh token can be redeemed once. */
  async register(
    familyId: string,
    userId: string,
    jti: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.familyModel.updateOne(
      { familyId },
      { familyId, userId, currentJti: jti, expiresAt },
      { upsert: true },
    );
  }

  /**
   * Redeem `jti` within `familyId`.
   *
   * `unknown` means no family exists — either it was revoked, it expired, or
   * the token predates rotation entirely. The caller decides what that means;
   * this service will not guess, because "assume valid" is exactly the failure
   * mode that made the old code silently accept dead tokens.
   */
  async rotate(familyId: string, jti: string): Promise<RotationResult> {
    const family = await this.familyModel.findOne({ familyId }).exec();

    if (!family) {
      return { status: 'unknown' };
    }

    if (family.currentJti !== jti) {
      // An older token in a rotated chain was presented. Someone has a copy.
      // There is no way to tell whether it is the attacker or the victim
      // holding the stale one, so the session ends for both.
      await this.revokeFamily(familyId);
      this.logger.warn(
        `Refresh token replay detected for user ${family.userId}; family revoked`,
      );
      return { status: 'replayed' };
    }

    const nextJti = randomUUID();
    await this.familyModel
      .updateOne({ familyId, currentJti: jti }, { currentJti: nextJti })
      .exec();

    return { status: 'rotated', nextJti };
  }

  /** End one session. Used by logout and by replay detection. */
  async revokeFamily(familyId: string): Promise<void> {
    await this.familyModel.deleteOne({ familyId }).exec();
  }

  /** End every session for a user. */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.familyModel.deleteMany({ userId }).exec();
    return result.deletedCount ?? 0;
  }
}
