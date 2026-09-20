import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import type { TrainerConnectionDocument } from '../../objects/trainer-connection/trainer-connection.schema';
import { getIdString } from '../../utils/helpers';

/**
 * Answers the one question authorization needs about a coaching relationship:
 * "has this client accepted this trainer?".
 *
 * Accepting an invite writes `User.trainerId`, but that field was never
 * consulted by any permission decision, so an accepted connection granted the
 * trainer exactly nothing. The connection document is the better source: it
 * records the status, so a revoked or declined link stops granting access the
 * moment it changes, and it is indexed on both ids.
 *
 * Lives in `common/` behind a @Global() module because `UserOwnershipGuard` is
 * mounted from many feature modules and each would otherwise have to import
 * the trainer-connection module just to resolve this dependency.
 */
@Injectable()
export class TrainerAccessService {
  private readonly logger = new Logger(TrainerAccessService.name);

  constructor(
    @InjectModel('TrainerConnection')
    private readonly connectionModel: Model<TrainerConnectionDocument>,
  ) {}

  /** True when `clientId` has an accepted connection to `trainerId`. */
  async isAcceptedTrainerOf(
    trainerId: string,
    clientId: string,
  ): Promise<boolean> {
    // A malformed id would make Mongoose throw a CastError, which the global
    // filter would surface as a 500 on what is really just a denied request.
    if (!isValidObjectId(trainerId) || !isValidObjectId(clientId)) {
      return false;
    }

    const connection = await this.connectionModel
      .exists({ trainerId, clientId, status: 'accepted' })
      .exec();

    return connection !== null;
  }

  /**
   * Every accepted connection this user is part of, from either side.
   *
   * `listClientIds` answers the trainer's half only, which is all authorization
   * ever needed. A conversation needs both: the client's counterpart is their
   * trainer, and the same person can be a trainer to one user and a client of
   * another. Returning the pair rather than a flat list of ids keeps the
   * direction — who is the trainer — attached to it, because that is what the
   * message thread is keyed on.
   */
  async listAcceptedPairs(
    userId: string,
  ): Promise<{ trainerId: string; clientId: string }[]> {
    if (!isValidObjectId(userId)) {
      return [];
    }

    const connections = await this.connectionModel
      .find({
        status: 'accepted',
        $or: [{ trainerId: userId }, { clientId: userId }],
      })
      .select('trainerId clientId')
      .lean()
      .exec();

    return connections.map((c) => ({
      trainerId: getIdString(c.trainerId),
      clientId: getIdString(c.clientId),
    }));
  }

  /** Client ids this trainer currently coaches. */
  async listClientIds(trainerId: string): Promise<string[]> {
    if (!isValidObjectId(trainerId)) {
      return [];
    }

    const connections = await this.connectionModel
      .find({ trainerId, status: 'accepted' })
      .select('clientId')
      .lean()
      .exec();

    return connections.map((c) => getIdString(c.clientId));
  }
}
