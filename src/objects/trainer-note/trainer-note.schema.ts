import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

/**
 * A trainer's private note about one client.
 *
 * Deliberately a separate collection from `Message`, not the same one with a
 * `private: true` flag. The two differ in exactly the property that must never
 * be got wrong — who may read them — and a boolean is one forgotten `.find()`
 * filter away from showing a coach's private assessment to the person it is
 * about. Two collections make that mistake impossible to write.
 */

export const MAX_NOTE_LENGTH = 5000;

export const trainerNoteSchema = z.object({
  trainerId: z.union([z.string(), z.object({}).passthrough()]),
  clientId: z.union([z.string(), z.object({}).passthrough()]),
  body: z.string().max(MAX_NOTE_LENGTH),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type TrainerNote = z.infer<typeof trainerNoteSchema>;

export const TrainerNoteSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, default: '', maxlength: MAX_NOTE_LENGTH },
  },
  {
    timestamps: true,
  },
);

// One note per pair — the note is edited, not appended to.
TrainerNoteSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });

export type TrainerNoteDocument = HydratedDocument<TrainerNote>;
export type TrainerNoteModel = Model<TrainerNoteDocument>;
