import {
  ForbiddenException,
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';
import type { MessageDocument } from './message.schema';

/** How many messages one thread request returns, newest kept. */
const THREAD_LIMIT = 200;

export interface ThreadPair {
  trainerId: string;
  clientId: string;
}

export interface ThreadSummary {
  /** The other person, from the caller's point of view. */
  userId: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
  /** True when the caller is the trainer in this pair. */
  callerIsTrainer: boolean;
  lastMessage: {
    body: string;
    createdAt: Date;
    /** True when the caller wrote it. */
    fromMe: boolean;
  } | null;
  unread: number;
}

interface UserRow {
  _id: Types.ObjectId;
  fullName?: string;
  email?: string;
  avatarUrl?: string | null;
}

interface ThreadAggRow {
  _id: { trainerId: Types.ObjectId; clientId: Types.ObjectId };
  lastBody: string;
  lastAt: Date;
  lastSenderId: Types.ObjectId;
  unread: number;
}

/**
 * Trainer↔client messaging.
 *
 * The authorization rule is one sentence: **a message may exist only inside an
 * accepted connection**, and it is checked on every route, in both directions.
 * That is not the same as the usual ownership check in this codebase, for a
 * reason worth stating — `UserOwnershipGuard` grants a trainer access to a
 * client's data on `GET` and `HEAD` only, and sending a message is a `POST`.
 * So the guard cannot be reused here; the pair is resolved explicitly instead.
 *
 * Resolving it does not consult the caller's role. A trainer can also be
 * somebody else's client, so "the caller is a trainer, therefore they are the
 * trainer of this pair" is wrong in exactly the case that matters. Both
 * directions are checked, and the tie — two people who coach each other — is
 * broken deterministically so both of them land in the *same* thread rather
 * than in two threads that each show half the conversation.
 *
 * A revoked connection stops both directions at once, because the connection
 * document is the source, not `User.trainerId`. The history stays in the
 * collection: revoking access is not the same as deleting what was said, and
 * silently destroying a conversation would be the more surprising behaviour.
 */
@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @InjectModel('Message')
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel('User')
    private readonly userModel: Model<unknown>,
    private readonly trainerAccess: TrainerAccessService,
  ) {}

  /** Write a message into the pair the two users form. */
  async send(
    callerId: string,
    otherUserId: string,
    body: string,
  ): Promise<MessageDocument> {
    const pair = await this.resolvePair(callerId, otherUserId);

    const created = await this.messageModel.create({
      trainerId: new Types.ObjectId(pair.trainerId),
      clientId: new Types.ObjectId(pair.clientId),
      senderId: new Types.ObjectId(callerId),
      body: body.trim(),
      readAt: null,
    });

    this.logger.debug(
      `Message ${created._id.toString()} from ${callerId} in ` +
        `${pair.trainerId}/${pair.clientId}`,
    );
    return created;
  }

  /**
   * One conversation, oldest first.
   *
   * `after` is what makes polling cheap: the client asks for what it has not
   * seen rather than re-reading the thread every fifteen seconds.
   */
  async getThread(
    callerId: string,
    otherUserId: string,
    after?: string,
  ): Promise<MessageDocument[]> {
    const pair = await this.resolvePair(callerId, otherUserId);

    const filter: Record<string, unknown> = {
      trainerId: new Types.ObjectId(pair.trainerId),
      clientId: new Types.ObjectId(pair.clientId),
    };

    if (after) {
      const since = new Date(after);
      if (Number.isNaN(since.getTime())) {
        throw new BadRequestException('`after` must be an ISO date');
      }
      filter.createdAt = { $gt: since };
    }

    // Newest `THREAD_LIMIT`, then flipped back into reading order — taking the
    // first 200 of a long conversation would show the oldest messages and
    // silently hide today's.
    const messages = await this.messageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(THREAD_LIMIT)
      .lean<MessageDocument[]>()
      .exec();

    return messages.reverse();
  }

  /**
   * Every conversation the caller can have — including the ones nobody has
   * started yet.
   *
   * A trainer who has just connected a client should see that client in the
   * list with no messages, not an empty screen that gives them nowhere to
   * write. So the list is built from the accepted connections and the messages
   * are joined onto it, not the other way around.
   */
  async listThreads(callerId: string): Promise<ThreadSummary[]> {
    const pairs = await this.trainerAccess.listAcceptedPairs(callerId);
    if (pairs.length === 0) return [];

    const counterpartIds = pairs.map((pair) =>
      pair.trainerId === callerId ? pair.clientId : pair.trainerId,
    );

    const [users, aggregated] = await Promise.all([
      this.userModel
        .find({
          _id: { $in: counterpartIds.map((id) => new Types.ObjectId(id)) },
        })
        .select('fullName email avatarUrl')
        .lean<UserRow[]>()
        .exec(),
      this.aggregateThreads(callerId, pairs),
    ]);

    const usersById = new Map(users.map((user) => [user._id.toString(), user]));
    const aggByKey = new Map(
      aggregated.map((row) => [
        `${row._id.trainerId.toString()}:${row._id.clientId.toString()}`,
        row,
      ]),
    );

    const summaries = pairs.map((pair) => {
      const callerIsTrainer = pair.trainerId === callerId;
      const counterpartId = callerIsTrainer ? pair.clientId : pair.trainerId;
      const user = usersById.get(counterpartId);
      const agg = aggByKey.get(`${pair.trainerId}:${pair.clientId}`);

      return {
        userId: counterpartId,
        fullName: user?.fullName ?? '',
        email: user?.email ?? '',
        avatarUrl: user?.avatarUrl ?? null,
        callerIsTrainer,
        lastMessage: agg
          ? {
              body: agg.lastBody,
              createdAt: agg.lastAt,
              fromMe: agg.lastSenderId.toString() === callerId,
            }
          : null,
        unread: agg?.unread ?? 0,
      };
    });

    // Unread first, then by recency. A thread nobody has written in yet sorts
    // last rather than being hidden.
    return summaries.sort((a, b) => {
      if (b.unread !== a.unread) return b.unread - a.unread;
      const at = a.lastMessage?.createdAt?.getTime() ?? 0;
      const bt = b.lastMessage?.createdAt?.getTime() ?? 0;
      return bt - at;
    });
  }

  /**
   * Mark the *other* party's messages as read.
   *
   * Only theirs. Stamping the caller's own sends would make the unread count
   * drift away from what the recipient actually sees, and the count is the
   * only thing on the nav bar claiming something is waiting.
   */
  async markRead(
    callerId: string,
    otherUserId: string,
  ): Promise<{ updated: number }> {
    const pair = await this.resolvePair(callerId, otherUserId);

    const result = await this.messageModel.updateMany(
      {
        trainerId: new Types.ObjectId(pair.trainerId),
        clientId: new Types.ObjectId(pair.clientId),
        senderId: { $ne: new Types.ObjectId(callerId) },
        readAt: null,
      },
      { $set: { readAt: new Date() } },
    );

    return { updated: result.modifiedCount ?? 0 };
  }

  /** The nav badge: unread messages across every live connection. */
  async unreadCount(callerId: string): Promise<{ unread: number }> {
    const pairs = await this.trainerAccess.listAcceptedPairs(callerId);
    if (pairs.length === 0) return { unread: 0 };

    const unread = await this.messageModel.countDocuments({
      // Scoped to the accepted pairs, not to "any message mentioning me":
      // a badge that counts a revoked conversation points at a thread the
      // user can no longer open.
      $or: pairs.map((pair) => ({
        trainerId: new Types.ObjectId(pair.trainerId),
        clientId: new Types.ObjectId(pair.clientId),
      })),
      senderId: { $ne: new Types.ObjectId(callerId) },
      readAt: null,
    });

    return { unread };
  }

  // ─── the pair ─────────────────────────────────────────────────

  /**
   * Which trainer/client pair these two people form, or 403.
   *
   * Role-agnostic on purpose — see the class comment. The tiebreak in the
   * mutual-coaching case is arbitrary but *stable*: the same two users always
   * resolve to the same pair, whoever is asking, which is the only property
   * that matters for both of them to see one conversation.
   */
  private async resolvePair(
    callerId: string,
    otherUserId: string,
  ): Promise<ThreadPair> {
    if (!isValidObjectId(callerId) || !isValidObjectId(otherUserId)) {
      throw new ForbiddenException('No conversation with this user');
    }
    if (callerId === otherUserId) {
      throw new BadRequestException('You cannot message yourself');
    }

    const [callerIsTrainer, callerIsClient] = await Promise.all([
      this.trainerAccess.isAcceptedTrainerOf(callerId, otherUserId),
      this.trainerAccess.isAcceptedTrainerOf(otherUserId, callerId),
    ]);

    if (callerIsTrainer && callerIsClient) {
      const [trainerId, clientId] = [callerId, otherUserId].sort();
      return { trainerId, clientId };
    }
    if (callerIsTrainer) {
      return { trainerId: callerId, clientId: otherUserId };
    }
    if (callerIsClient) {
      return { trainerId: otherUserId, clientId: callerId };
    }

    // Never says whether the other id exists — the same refusal for a stranger
    // and for a revoked client.
    this.logger.warn(`Denied thread access: ${callerId} → ${otherUserId}`);
    throw new ForbiddenException('No conversation with this user');
  }

  private async aggregateThreads(
    callerId: string,
    pairs: ThreadPair[],
  ): Promise<ThreadAggRow[]> {
    return this.messageModel.aggregate<ThreadAggRow>([
      {
        $match: {
          $or: pairs.map((pair) => ({
            trainerId: new Types.ObjectId(pair.trainerId),
            clientId: new Types.ObjectId(pair.clientId),
          })),
        },
      },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: { trainerId: '$trainerId', clientId: '$clientId' },
          lastBody: { $last: '$body' },
          lastAt: { $last: '$createdAt' },
          lastSenderId: { $last: '$senderId' },
          unread: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$readAt', null] },
                    { $ne: ['$senderId', new Types.ObjectId(callerId)] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
  }
}
