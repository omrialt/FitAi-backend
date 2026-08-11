import { Schema, HydratedDocument, Model } from 'mongoose';

/**
 * One document per login session ("family" of refresh tokens).
 *
 * Refresh tokens used to be immortal: `refreshToken()` issued a new pair and
 * left the presented token valid for its full seven days, so a leaked token
 * stayed a working key to the account and logout revoked only the access
 * token. Rotation needs somewhere to remember which token in a chain is the
 * live one, and that is what this collection is.
 *
 * `currentJti` is the only refresh token in the family that may be redeemed.
 * Presenting any older one means the token was captured and replayed, so the
 * whole family is deleted rather than just that token — the attacker and the
 * legitimate user are indistinguishable at that point, and ending the session
 * is the safe answer for both.
 */
export interface RefreshTokenFamily {
  familyId: string;
  userId: string;
  currentJti: string;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export const RefreshTokenFamilySchema = new Schema(
  {
    familyId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    currentJti: {
      type: String,
      required: true,
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

// Families die with the refresh token that anchors them; without this the
// collection grows by one document per login forever.
RefreshTokenFamilySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenFamilyDocument = HydratedDocument<RefreshTokenFamily>;
export type RefreshTokenFamilyModel = Model<RefreshTokenFamilyDocument>;
