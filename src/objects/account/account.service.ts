import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';

import { CloudinaryService } from '../../common/cloudinary/cloudinary.service';

/**
 * These models are addressed generically — the cascade treats every collection
 * the same way — so they are typed by their shape rather than by twelve
 * imported document interfaces that would never be used for anything else.
 */
type AnyDoc = Record<string, unknown>;

/**
 * Collections keyed by a plain `userId` — the whole cascade except the odd
 * ones. Exported so the tests assert against this list rather than a copy of
 * it that could drift out of step.
 */
export const OWNED_BY_USER_ID = [
  'TrainingPlan',
  'NutritionPlan',
  'PhysicalData',
  'ProgressStats',
  'CurrentStatus',
  'WorkoutSession',
  'AiRecommendation',
  'TokenBlacklist',
  'RefreshTokenFamily',
  'AuthCode',
] as const;

type OwnedModelName = (typeof OWNED_BY_USER_ID)[number];

export interface DeletionReport {
  /** Documents removed, per collection. */
  removed: Record<string, number>;
  /** Documents belonging to *other* users that referenced this one. */
  scrubbed: Record<string, number>;
}

/**
 * Account-level operations over a user's whole footprint: export it, or erase
 * it.
 *
 * This is a regulatory requirement rather than a feature — the product stores
 * weight, body fat, measurements, photos and a full training history, which is
 * health data. The important detail is that both operations must know about
 * *every* collection: an export that misses one is incomplete, and a deletion
 * that misses one leaves health data attached to an id that no longer has an
 * account to explain it.
 *
 * The list is therefore declared once, above, and used by both.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @InjectModel('User') private readonly userModel: Model<AnyDoc>,
    @InjectModel('TrainingPlan')
    private readonly trainingPlanModel: Model<AnyDoc>,
    @InjectModel('NutritionPlan')
    private readonly nutritionPlanModel: Model<AnyDoc>,
    @InjectModel('PhysicalData')
    private readonly physicalDataModel: Model<AnyDoc>,
    @InjectModel('ProgressStats')
    private readonly progressStatsModel: Model<AnyDoc>,
    @InjectModel('CurrentStatus')
    private readonly currentStatusModel: Model<AnyDoc>,
    @InjectModel('WorkoutSession')
    private readonly workoutSessionModel: Model<AnyDoc>,
    @InjectModel('AiRecommendation')
    private readonly aiRecommendationModel: Model<AnyDoc>,
    @InjectModel('TrainerConnection')
    private readonly trainerConnectionModel: Model<AnyDoc>,
    @InjectModel('TokenBlacklist')
    private readonly tokenBlacklistModel: Model<AnyDoc>,
    @InjectModel('RefreshTokenFamily')
    private readonly refreshTokenFamilyModel: Model<AnyDoc>,
    @InjectModel('AuthCode') private readonly authCodeModel: Model<AnyDoc>,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private modelFor(name: OwnedModelName): Model<AnyDoc> {
    const models: Record<OwnedModelName, Model<AnyDoc>> = {
      TrainingPlan: this.trainingPlanModel,
      NutritionPlan: this.nutritionPlanModel,
      PhysicalData: this.physicalDataModel,
      ProgressStats: this.progressStatsModel,
      CurrentStatus: this.currentStatusModel,
      WorkoutSession: this.workoutSessionModel,
      AiRecommendation: this.aiRecommendationModel,
      TokenBlacklist: this.tokenBlacklistModel,
      RefreshTokenFamily: this.refreshTokenFamilyModel,
      AuthCode: this.authCodeModel,
    };
    return models[name];
  }

  /**
   * Everything the service holds about one person, as JSON.
   *
   * Credentials and token material are excluded on purpose: a password hash
   * and a set of live refresh tokens are not "your data" in any useful sense,
   * and an export file is the least controlled copy of it that will ever
   * exist. Everything a person would actually want — their plans, their
   * measurements, their history — is here.
   */
  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.userModel
      .findById(userId)
      .select('-password -__v')
      .lean()
      .exec();

    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const objectId = new Types.ObjectId(userId);

    const [
      trainingPlans,
      nutritionPlans,
      physicalData,
      progressStats,
      currentStatus,
      workoutSessions,
      aiRecommendations,
      trainerConnections,
    ] = await Promise.all([
      this.trainingPlanModel.find({ userId: objectId }).lean().exec(),
      this.nutritionPlanModel.find({ userId: objectId }).lean().exec(),
      this.physicalDataModel.find({ userId: objectId }).lean().exec(),
      this.progressStatsModel.find({ userId: objectId }).lean().exec(),
      this.currentStatusModel.find({ userId: objectId }).lean().exec(),
      this.workoutSessionModel.find({ userId: objectId }).lean().exec(),
      this.aiRecommendationModel.find({ userId: objectId }).lean().exec(),
      this.trainerConnectionModel
        .find({ $or: [{ trainerId: objectId }, { clientId: objectId }] })
        .lean()
        .exec(),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      format: 'fitai-account-export/v1',
      note: 'Authentication credentials and session tokens are deliberately excluded.',
      account: user,
      trainingPlans,
      nutritionPlans,
      physicalData,
      progressStats,
      currentStatus,
      workoutSessions,
      aiRecommendations,
      trainerConnections,
    };
  }

  /**
   * Erase an account and everything belonging to it.
   *
   * Two distinct jobs, and missing the second is the usual way "delete my
   * account" quietly fails:
   *   1. delete the documents this user owns;
   *   2. remove this user from documents *other* people own — shared-with
   *      lists, active-plan lists, ratings, and the `trainerId` written on a
   *      client's profile. Skipping these leaves dangling references that
   *      populate to null and crash whatever renders them.
   *
   * Not transactional: Atlas supports multi-document transactions only on a
   * replica set, and the failure mode here is a partial delete leaving less
   * data than intended, which is the safe direction for an erasure request.
   * The report says exactly what was removed so a partial run is visible
   * rather than silent.
   */
  async deleteAccount(userId: string): Promise<DeletionReport> {
    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const objectId = new Types.ObjectId(userId);
    const removed: Record<string, number> = {};
    const scrubbed: Record<string, number> = {};

    for (const name of OWNED_BY_USER_ID) {
      const result = await this.modelFor(name)
        .deleteMany({ userId: objectId })
        .exec();
      removed[name] = result.deletedCount ?? 0;
    }

    // Connections name the user under one of two fields depending on which
    // side of the relationship they were on.
    const connections = await this.trainerConnectionModel
      .deleteMany({ $or: [{ trainerId: objectId }, { clientId: objectId }] })
      .exec();
    removed.TrainerConnection = connections.deletedCount ?? 0;

    // References held by other people's documents.
    for (const [label, model] of [
      ['TrainingPlan', this.trainingPlanModel],
      ['NutritionPlan', this.nutritionPlanModel],
    ] as const) {
      const result = await model
        .updateMany(
          {
            $or: [
              { sharedWith: objectId },
              { activeByUsers: objectId },
              { 'sharedAccess.userId': objectId },
              { 'ratings.userId': objectId },
            ],
          },
          {
            $pull: {
              sharedWith: objectId,
              activeByUsers: objectId,
              sharedAccess: { userId: objectId },
              ratings: { userId: objectId },
            },
          },
        )
        .exec();
      scrubbed[`${label}.references`] = result.modifiedCount ?? 0;
    }

    // A trainer's clients keep a pointer to them on their own profile.
    const orphanedClients = await this.userModel
      .updateMany({ trainerId: objectId }, { $set: { trainerId: null } })
      .exec();
    scrubbed['User.trainerId'] = orphanedClients.modifiedCount ?? 0;

    // The avatar lives outside Mongo, so deleting the row would otherwise
    // leave the image hosted and publicly addressable forever.
    await this.deleteAvatar(user as { avatarUrl?: string });

    await this.userModel.findByIdAndDelete(userId).exec();
    removed.User = 1;

    this.logger.log(
      `Deleted account ${userId}: ${JSON.stringify({ removed, scrubbed })}`,
    );

    return { removed, scrubbed };
  }

  /**
   * Confirm the caller is who they say before an irreversible action.
   *
   * A valid access token is not enough on its own here: tokens live for 15
   * minutes on an unlocked laptop, and this destroys everything. Accounts that
   * sign in with Google have no password to check, so they are asked to retype
   * their email address instead — a deliberate speed bump, not a secret.
   */
  async assertDeletionConfirmed(
    userId: string,
    confirmation: { password?: string; email?: string },
  ): Promise<void> {
    const user = await this.userModel
      .findById(userId)
      .select('+password email authProvider')
      .lean()
      .exec();

    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const account = user as {
      password?: string;
      email?: string;
      authProvider?: string;
    };

    if (account.authProvider === 'email' && account.password) {
      if (!confirmation.password) {
        throw new BadRequestException(
          'Your current password is required to delete this account',
        );
      }
      const valid = await bcrypt.compare(
        confirmation.password,
        account.password,
      );
      if (!valid) {
        throw new UnauthorizedException('Password is incorrect');
      }
      return;
    }

    const typed = confirmation.email?.trim().toLowerCase();
    if (!typed || typed !== account.email?.toLowerCase()) {
      throw new BadRequestException(
        'Type your account email address to confirm deletion',
      );
    }
  }

  private async deleteAvatar(user: { avatarUrl?: string }): Promise<void> {
    const publicId = this.publicIdFromUrl(user.avatarUrl);
    if (!publicId) return;

    try {
      await this.cloudinary.deleteImage(publicId);
    } catch (error) {
      // The account still goes away. A stranded image is worth a log line, not
      // a failed erasure the user then has to request again.
      this.logger.warn(
        `Could not delete avatar ${publicId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Cloudinary's delete API takes the public id, not the URL we store.
   * `.../upload/v1234567890/folder/name.jpg` -> `folder/name`.
   */
  private publicIdFromUrl(url?: string): string | null {
    if (!url?.includes('/upload/')) return null;

    const afterUpload = url.split('/upload/')[1];
    if (!afterUpload) return null;

    return (
      afterUpload
        // Drop the optional version segment.
        .replace(/^v\d+\//, '')
        // Drop the extension.
        .replace(/\.[^./]+$/, '') || null
    );
  }
}
