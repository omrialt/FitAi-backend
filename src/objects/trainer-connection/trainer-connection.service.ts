import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TrainerConnectionDocument } from './trainer-connection.schema';
import { UserDocument } from '../user/user.schema';
import { handleMongoError } from '../../utils/mongo.helpers';
import { getIdString } from '../../utils/helpers';
import { NodemailerService } from '../../common/nodemailer/nodemailer.service';

// Fields exposed when populating the other party of a connection
const CLIENT_FIELDS = 'fullName email avatarUrl role';
const TRAINER_FIELDS = 'fullName email avatarUrl';

@Injectable()
export class TrainerConnectionService {
  private readonly logger = new Logger(TrainerConnectionService.name);

  constructor(
    @InjectModel('TrainerConnection')
    private readonly connectionModel: Model<TrainerConnectionDocument>,
    @InjectModel('User')
    private readonly userModel: Model<UserDocument>,
    private readonly nodemailerService: NodemailerService,
  ) {}

  /**
   * A trainer invites a user to become their client. Idempotent for a pending
   * invite; a previously declined/revoked pair is reactivated to pending so the
   * unique (trainerId, clientId) index is respected.
   */
  async invite(
    trainerId: string,
    clientId: string,
  ): Promise<TrainerConnectionDocument> {
    try {
      if (trainerId === clientId) {
        throw new BadRequestException('You cannot connect to yourself');
      }

      const client = await this.userModel.findById(clientId);
      if (!client) {
        throw new NotFoundException('User not found');
      }
      if (client.role === 'admin') {
        throw new BadRequestException('An admin cannot be added as a client');
      }

      const existing = await this.connectionModel.findOne({
        trainerId,
        clientId,
      });

      if (existing) {
        if (existing.status === 'accepted') {
          throw new ConflictException('This user is already your client');
        }
        if (existing.status === 'pending') {
          // Invite already outstanding — return it rather than duplicating
          return existing;
        }
        existing.status = 'pending';
        existing.initiatedBy = 'trainer';
        this.logger.debug(`Reactivated invite ${existing._id.toString()}`);
        const reactivated = await existing.save();
        await this.notifyClientOfInvite(trainerId, client);
        return reactivated;
      }

      const created = await this.connectionModel.create({
        trainerId,
        clientId,
        status: 'pending',
        initiatedBy: 'trainer',
      });
      this.logger.debug(`Created invite ${created._id.toString()}`);
      await this.notifyClientOfInvite(trainerId, client);
      return created;
    } catch (error) {
      handleMongoError(error);
    }
  }

  /** Client accepts a pending invite — links User.trainerId. */
  async accept(
    connectionId: string,
    clientId: string,
  ): Promise<TrainerConnectionDocument> {
    const connection = await this.getOwnedPendingForClient(
      connectionId,
      clientId,
    );
    connection.status = 'accepted';
    await connection.save();
    await this.userModel.updateOne(
      { _id: clientId },
      { $set: { trainerId: connection.trainerId } },
    );
    this.logger.debug(`Client ${clientId} accepted ${connectionId}`);
    return connection;
  }

  /** Client declines a pending invite. */
  async decline(
    connectionId: string,
    clientId: string,
  ): Promise<TrainerConnectionDocument> {
    const connection = await this.getOwnedPendingForClient(
      connectionId,
      clientId,
    );
    connection.status = 'declined';
    await connection.save();
    this.logger.debug(`Client ${clientId} declined ${connectionId}`);
    return connection;
  }

  /**
   * Either party ends the connection. If it was accepted, the client's
   * User.trainerId is cleared — but only if it still points at this trainer,
   * so a newer trainer link is never clobbered.
   */
  async remove(
    connectionId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    const connection = await this.connectionModel.findById(connectionId);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    const isParty =
      getIdString(connection.trainerId) === userId ||
      getIdString(connection.clientId) === userId;
    if (!isParty) {
      throw new ForbiddenException('You are not part of this connection');
    }

    const wasAccepted = connection.status === 'accepted';
    connection.status = 'revoked';
    await connection.save();

    if (wasAccepted) {
      await this.userModel.updateOne(
        { _id: connection.clientId, trainerId: connection.trainerId },
        { $set: { trainerId: null } },
      );
    }
    this.logger.debug(`User ${userId} removed connection ${connectionId}`);
    return { success: true };
  }

  /** A trainer's roster: accepted clients plus invites they still have pending. */
  async listClients(trainerId: string): Promise<TrainerConnectionDocument[]> {
    return this.connectionModel
      .find({ trainerId, status: { $in: ['accepted', 'pending'] } })
      .populate('clientId', CLIENT_FIELDS)
      .sort({ updatedAt: -1 })
      .exec();
  }

  /** A user's view: invites received plus their current accepted trainer. */
  async listForClient(clientId: string): Promise<TrainerConnectionDocument[]> {
    return this.connectionModel
      .find({ clientId, status: { $in: ['pending', 'accepted'] } })
      .populate('trainerId', TRAINER_FIELDS)
      .sort({ updatedAt: -1 })
      .exec();
  }

  /**
   * Mail the client that an invite is waiting.
   *
   * Best-effort and deliberately outside the try/catch that wraps the write:
   * the invite itself is already saved, so a mail failure must not roll it back
   * or surface as an error. Before this, the only way to discover an invite was
   * to open the app and notice a badge.
   */
  private async notifyClientOfInvite(
    trainerId: string,
    client: UserDocument,
  ): Promise<void> {
    try {
      const trainer = await this.userModel
        .findById(trainerId)
        .select('fullName')
        .lean();

      await this.nodemailerService.sendTrainerInviteEmail(
        client.email,
        trainer?.fullName ?? 'A trainer',
        client.fullName,
      );
    } catch (error) {
      this.logger.error(
        `Failed to email invite notification to ${client.email}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Load a connection and assert the caller is its client and it is pending. */
  private async getOwnedPendingForClient(
    connectionId: string,
    clientId: string,
  ): Promise<TrainerConnectionDocument> {
    const connection = await this.connectionModel.findById(connectionId);
    if (!connection) {
      throw new NotFoundException('Connection not found');
    }
    if (getIdString(connection.clientId) !== clientId) {
      throw new ForbiddenException('This invite is not addressed to you');
    }
    if (connection.status !== 'pending') {
      throw new BadRequestException('This invite is no longer pending');
    }
    return connection;
  }
}
