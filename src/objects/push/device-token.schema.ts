import { Schema, Types, HydratedDocument } from 'mongoose';

/**
 * One phone that can receive push notifications for one user.
 *
 * The FCM token is unique: when the same phone signs in as someone else the
 * row moves to the new user, so a shared or handed-down phone never receives
 * the previous owner's messages. Deleted with the account (AccountService
 * cascade) and never exported — it is a delivery address, not personal data.
 */
export interface DeviceToken {
  userId: Types.ObjectId;
  token: string;
  platform: 'android';
  lastSeenAt: Date;
}

export const DeviceTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['android'], required: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type DeviceTokenDocument = HydratedDocument<DeviceToken>;
