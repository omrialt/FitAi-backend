import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

/**
 * Progress photographs.
 *
 * The gap analysis called this "the easiest technically, the heaviest on
 * privacy", and the schema is where that gets settled. Three decisions, all
 * of which are about what this collection refuses to do:
 *
 * **`visibility` defaults to `private` and is per photo.** It is not derived
 * from the trainer connection, and it is not derived from whether the user
 * already shares their measurements. Someone who agreed that their coach may
 * see their waist circumference has not agreed that their coach may see them
 * in their underwear, and inheriting one consent into the other is precisely
 * the "default dragged in from the measurements" the report warned against.
 * Sharing is an action taken on one photo at a time.
 *
 * **No URL is stored.** Only Cloudinary's `publicId`, for an asset uploaded
 * with authenticated delivery. A stored URL is a permanent link, and a
 * permanent link makes `visibility` decorative — un-sharing a photo would
 * change a flag while the last URL anyone copied kept working. Every URL is
 * minted per request, after the permission check.
 *
 * **`takenAt` is separate from `createdAt`.** A timeline is about when the
 * photo was taken, and people upload three months of backlog in one evening.
 */

export const photoVisibilitySchema = z.enum(['private', 'trainer']);

export const photoPoseSchema = z.enum(['front', 'side', 'back', 'other']);

export const bodyPhotoSchema = z.object({
  userId: z.union([z.string(), z.object({}).passthrough()]),
  /** Cloudinary identity for an `type: 'authenticated'` asset. Never a URL. */
  publicId: z.string().min(3).max(300),
  version: z.number().int().positive().optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  /** Lets a timeline compare like with like instead of front against back. */
  pose: photoPoseSchema.default('front'),
  /** Private until the user says otherwise, one photo at a time. */
  visibility: photoVisibilitySchema.default('private'),
  /** Kilograms on the day, so the timeline can sit next to the weight curve. */
  weightKg: z.number().positive().optional().nullable(),
  note: z.string().max(300).optional().nullable(),
  takenAt: z.date().default(() => new Date()),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type BodyPhoto = z.infer<typeof bodyPhotoSchema>;
export type PhotoVisibility = z.infer<typeof photoVisibilitySchema>;
export type PhotoPose = z.infer<typeof photoPoseSchema>;

export const PHOTO_VISIBILITIES = photoVisibilitySchema.options;
export const PHOTO_POSES = photoPoseSchema.options;

export const BodyPhotoSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    publicId: { type: String, required: true },
    version: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    pose: { type: String, enum: PHOTO_POSES, default: 'front' },
    visibility: {
      type: String,
      enum: PHOTO_VISIBILITIES,
      // Also defaulted at the database level, not only in the DTO. A write
      // path that forgets to set it must produce a private photo, never a
      // shared one — the safe default has to survive a future caller.
      default: 'private',
      required: true,
    },
    weightKg: { type: Number, default: null },
    note: { type: String, default: null },
    takenAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, validateBeforeSave: true },
);

// The timeline query: one user's photos, newest first.
BodyPhotoSchema.index({ userId: 1, takenAt: -1 });
// The trainer query is the same one plus a visibility filter, and it must not
// fall back to a collection scan — that is the read that has to stay narrow.
BodyPhotoSchema.index({ userId: 1, visibility: 1, takenAt: -1 });

BodyPhotoSchema.pre('save', function (next) {
  const result = bodyPhotoSchema.safeParse(this.toObject());
  if (!result.success) {
    next(new Error(result.error.message));
  }
  next();
});

export type BodyPhotoDocument = HydratedDocument<BodyPhoto>;
export type BodyPhotoModel = Model<BodyPhotoDocument>;
