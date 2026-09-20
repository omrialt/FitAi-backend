import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

/**
 * One message between a trainer and their client.
 *
 * The pair is stored as `trainerId` + `clientId` rather than as a pair of
 * "participants", because that is the shape every permission question in this
 * codebase is already asked in: `TrainerAccessService.isAcceptedTrainerOf`
 * takes a trainer and a client, and a thread that could not be expressed that
 * way would be a thread no existing check could authorize.
 *
 * `senderId` is which of the two wrote it — it is always one of the pair, and
 * the service refuses to write anything else.
 */

/** Long enough for a real instruction, short enough not to be a document. */
export const MAX_MESSAGE_LENGTH = 2000;

export const messageSchema = z.object({
  trainerId: z.union([z.string(), z.object({}).passthrough()]),
  clientId: z.union([z.string(), z.object({}).passthrough()]),
  senderId: z.union([z.string(), z.object({}).passthrough()]),
  body: z
    .string()
    .trim()
    .min(1, 'A message cannot be empty')
    .max(MAX_MESSAGE_LENGTH),
  /** When the *recipient* opened it. Null until then. */
  readAt: z.date().nullable().default(null),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type Message = z.infer<typeof messageSchema>;

export const MessageSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Stored and served as plain text. Nothing renders it as markup, and the
    // cap is enforced here rather than only in the UI.
    body: { type: String, required: true, maxlength: MAX_MESSAGE_LENGTH },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

// The thread read, newest last — the only query the conversation view makes.
MessageSchema.index({ trainerId: 1, clientId: 1, createdAt: 1 });
// The unread badge, per recipient side.
MessageSchema.index({ clientId: 1, readAt: 1 });
MessageSchema.index({ trainerId: 1, readAt: 1 });

export type MessageDocument = HydratedDocument<Message>;
export type MessageModel = Model<MessageDocument>;
