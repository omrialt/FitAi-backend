import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import type { AuthCode, AuthCodePurpose } from './auth-code.schema';

/** What a redeemed code resolves to. Never includes the code itself. */
export interface RedeemedAuthCode {
  userId: string;
  needsProfile: boolean;
  codeChallenge?: string;
}

/**
 * Issues and redeems the one-time codes that carry a Google sign-in from the
 * backend redirect to the frontend, in place of putting tokens in the URL.
 */
@Injectable()
export class AuthCodeService {
  /** Long enough for the round trip, short enough that a leaked URL is stale. */
  private static readonly TTL_MS = 2 * 60 * 1000;

  /** A calendar consent screen can take a while to read; still short-lived. */
  private static readonly CALENDAR_TTL_MS = 10 * 60 * 1000;

  constructor(
    @InjectModel('AuthCode')
    private readonly authCodeModel: Model<AuthCode>,
  ) {}

  /**
   * Mint a code for `userId` and return the plaintext exactly once.
   *
   * `codeChallenge` binds the code to a PKCE verifier held by the Android app;
   * such a code can only be redeemed together with that verifier.
   */
  async issue(
    userId: string,
    needsProfile: boolean,
    codeChallenge?: string,
  ): Promise<string> {
    const code = randomBytes(32).toString('hex');

    await this.authCodeModel.create({
      codeHash: AuthCodeService.hash(code),
      userId,
      needsProfile,
      ...(codeChallenge ? { codeChallenge } : {}),
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
  async redeem(
    code: string,
    purpose: AuthCodePurpose = 'login',
  ): Promise<RedeemedAuthCode | null> {
    if (typeof code !== 'string' || code.length === 0 || code.length > 128) {
      return null;
    }
    const doc = await this.authCodeModel
      .findOneAndDelete({
        codeHash: AuthCodeService.hash(code),
        expiresAt: { $gt: new Date() },
        // A code minted for one purpose is useless for the other. `null`
        // also matches login codes written before the field existed.
        purpose: purpose === 'login' ? { $in: ['login', null] } : purpose,
      })
      .exec();

    if (!doc) {
      return null;
    }

    return {
      userId: doc.userId,
      needsProfile: doc.needsProfile,
      ...(doc.codeChallenge ? { codeChallenge: doc.codeChallenge } : {}),
    };
  }

  /**
   * Mint the OAuth `state` for connecting Google Calendar (SEC-02).
   *
   * The state used to be the bare user id, so anyone could finish the flow
   * with their own Google account and `state=<someone else's id>`, and have
   * that person's training schedule synced into the attacker's calendar.
   */
  async issueCalendarState(userId: string): Promise<string> {
    const code = randomBytes(32).toString('hex');
    await this.authCodeModel.create({
      codeHash: AuthCodeService.hash(code),
      userId,
      needsProfile: false,
      purpose: 'calendar',
      expiresAt: new Date(Date.now() + AuthCodeService.CALENDAR_TTL_MS),
    });
    return code;
  }

  /** The user a calendar state was minted for, or `null`. Single use. */
  async redeemCalendarState(state: unknown): Promise<string | null> {
    if (typeof state !== 'string') return null;
    const redeemed = await this.redeem(state, 'calendar');
    return redeemed?.userId ?? null;
  }

  private static hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
