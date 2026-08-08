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
