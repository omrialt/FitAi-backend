import { z } from 'zod';
import { Schema, HydratedDocument, Model } from 'mongoose';

// Define Zod enums
export const connectionStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'revoked',
]);
export const connectionInitiatorSchema = z.enum(['trainer', 'client']);

// Define the Zod schema for validation
export const trainerConnectionSchema = z.object({
  trainerId: z.union([z.string(), z.object({}).passthrough()]),
  clientId: z.union([z.string(), z.object({}).passthrough()]),
  status: connectionStatusSchema.default('pending'),
  initiatedBy: connectionInitiatorSchema.default('trainer'),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

// Create types from Zod schema
export type TrainerConnection = z.infer<typeof trainerConnectionSchema>;
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
export type ConnectionInitiator = z.infer<typeof connectionInitiatorSchema>;

// Define Mongoose schema
export const TrainerConnectionSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'revoked'],
      default: 'pending',
    },
    initiatedBy: {
      type: String,
      enum: ['trainer', 'client'],
      default: 'trainer',
    },
  },
  {
    timestamps: true,
  },
);

// One record per trainer/client pair — re-inviting reuses the existing doc
TrainerConnectionSchema.index({ trainerId: 1, clientId: 1 }, { unique: true });
TrainerConnectionSchema.index({ clientId: 1 });
TrainerConnectionSchema.index({ trainerId: 1 });

// Type for a hydrated document
export type TrainerConnectionDocument = HydratedDocument<TrainerConnection>;

// Type for the model
export type TrainerConnectionModel = Model<TrainerConnectionDocument>;
