import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';
import type { TrainerNoteDocument } from './trainer-note.schema';

/**
 * The trainer's own notebook, one page per client.
 *
 * There is no route anywhere that returns a note to the person it is about,
 * and the only lookup in this service is keyed on `trainerId` **from the
 * authenticated caller**, never from the request body — so a note cannot be
 * addressed by anyone but its author, whatever they send.
 *
 * The access check is still made on top of that. A note is about a client, so
 * writing one after the connection ended would mean keeping a file on somebody
 * who has left; the same accepted-connection rule that gates their training
 * data gates this.
 */
@Injectable()
export class TrainerNoteService {
  private readonly logger = new Logger(TrainerNoteService.name);

  constructor(
    @InjectModel('TrainerNote')
    private readonly noteModel: Model<TrainerNoteDocument>,
    private readonly trainerAccess: TrainerAccessService,
  ) {}

  /** The note this trainer keeps on this client, or `null` if there is none. */
  async get(
    trainerId: string,
    clientId: string,
  ): Promise<TrainerNoteDocument | null> {
    await this.assertCoaches(trainerId, clientId);

    return this.noteModel
      .findOne({
        trainerId: new Types.ObjectId(trainerId),
        clientId: new Types.ObjectId(clientId),
      })
      .lean<TrainerNoteDocument | null>()
      .exec();
  }

  /** Replace the note. Upserted, because the first save is also an edit. */
  async save(
    trainerId: string,
    clientId: string,
    body: string,
  ): Promise<TrainerNoteDocument> {
    await this.assertCoaches(trainerId, clientId);

    const saved = await this.noteModel
      .findOneAndUpdate(
        {
          trainerId: new Types.ObjectId(trainerId),
          clientId: new Types.ObjectId(clientId),
        },
        { $set: { body } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .lean<TrainerNoteDocument>()
      .exec();

    this.logger.debug(`Trainer ${trainerId} saved a note on ${clientId}`);
    return saved;
  }

  private async assertCoaches(
    trainerId: string,
    clientId: string,
  ): Promise<void> {
    if (!isValidObjectId(trainerId) || !isValidObjectId(clientId)) {
      throw new ForbiddenException('This client is not yours');
    }

    const coaches = await this.trainerAccess.isAcceptedTrainerOf(
      trainerId,
      clientId,
    );
    if (!coaches) {
      // Same refusal whether the id is a stranger, a pending invite or a
      // revoked client — the response must not reveal which.
      this.logger.warn(`Denied note access: ${trainerId} → ${clientId}`);
      throw new ForbiddenException('This client is not yours');
    }
  }
}
