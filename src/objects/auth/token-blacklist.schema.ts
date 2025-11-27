import { Schema, HydratedDocument, Model } from 'mongoose';

export interface TokenBlacklist {
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt?: Date;
}

export const TokenBlacklistSchema = new Schema(
  {
    token: {
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
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// TTL index to automatically remove expired tokens from database
TokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type TokenBlacklistDocument = HydratedDocument<TokenBlacklist>;
export type TokenBlacklistModel = Model<TokenBlacklistDocument>;
