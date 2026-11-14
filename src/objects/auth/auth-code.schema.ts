import { Schema, HydratedDocument, Model } from 'mongoose';

/**
 * Short-lived, single-use handoff code for the Google OAuth redirect.
 *
 * The callback used to redirect to the frontend with `accessToken`,
 * `refreshToken` and the full user object in the query string. URLs are the
 * least private part of a request: they land in browser history, in the
 * `Referer` header of the next outbound request, and in the access log of
 * every proxy on the way. This collection replaces all of that with one opaque
 * code that is worthless thirty seconds after it is redeemed.
 *
 * Only the SHA-256 of the code is stored. The code itself exists solely in the
 * redirect URL and in the request that redeems it, so a leaked database dump
 * does not hand over a live login.
 *
 * No tokens are stored here — the exchange endpoint mints them at redemption
 * time, so a code sitting unredeemed is not a token waiting to be stolen.
 */
/**
 * What a code may be redeemed for. `calendar` codes are the OAuth `state` of
 * the Google Calendar connect flow (SEC-02); they travel through Google's URL,
 * so they must never be redeemable as a sign-in at `/auth/google/exchange`.
 */
export type AuthCodePurpose = 'login' | 'calendar';

export interface AuthCode {
  codeHash: string;
  userId: string;
  needsProfile: boolean;
  /** PKCE S256 challenge, for codes issued to the Android app. */
  codeChallenge?: string;
  purpose?: AuthCodePurpose;
  expiresAt: Date;
  createdAt?: Date;
}

export const AuthCodeSchema = new Schema(
  {
    codeHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
    },
    needsProfile: {
      type: Boolean,
      default: false,
    },
    codeChallenge: {
      type: String,
      required: false,
    },
    purpose: {
      type: String,
      enum: ['login', 'calendar'],
      default: 'login',
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Redemption deletes the document; this only sweeps codes nobody ever used.
AuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthCodeDocument = HydratedDocument<AuthCode>;
export type AuthCodeModel = Model<AuthCodeDocument>;
