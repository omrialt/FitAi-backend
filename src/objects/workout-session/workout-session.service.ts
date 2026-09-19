import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import type { WorkoutSessionDocument } from './workout-session.schema';
import type {
  CreateWorkoutSessionDto,
  ListWorkoutSessionsDto,
} from '../../interfaces/workout-session.interfaces';
import { getIdString } from '../../utils/helpers';

/** What a caller is, for the ownership checks on id-addressed routes. */
interface Caller {
  id: string;
  role?: string;
}

@Injectable()
export class WorkoutSessionService {
  private readonly logger = new Logger(WorkoutSessionService.name);

  constructor(
    @InjectModel('WorkoutSession')
    private readonly sessionModel: Model<WorkoutSessionDocument>,
  ) {}

  /**
   * Files a completed workout.
   *
   * Idempotent when the caller supplies a `clientId`: sending the same session
   * twice returns the first one instead of creating a second. That is what
   * lets an offline queue retry safely — a request can succeed on the server
   * and still fail on the wire, and the phone has no way to tell the
   * difference.
   *
   * The check is belt and braces: the pre-read catches the ordinary retry and
   * keeps the response fast, and the unique index catches the case the
   * pre-read cannot — two requests racing on two lambdas.
   */
  async create(
    userId: string,
    dto: CreateWorkoutSessionDto,
  ): Promise<WorkoutSessionDocument> {
    if (dto.clientId) {
      const existing = await this.sessionModel
        .findOne({ userId, clientId: dto.clientId })
        .exec();

      if (existing) {
        this.logger.debug(
          `Replayed session ${existing._id.toString()} for ${userId}`,
        );
        return existing;
      }
    }

    try {
      const session = await this.sessionModel.create({
        ...dto,
        userId,
        planId: dto.planId ?? null,
        // A client clock can be wrong or hostile; a session dated in the future
        // would poison every rolling-window statistic, so it is clamped.
        performedAt: this.resolvePerformedAt(dto.performedAt),
        source: 'app',
      });

      this.logger.debug(
        `Logged session ${session._id.toString()} for ${userId}`,
      );
      return session;
    } catch (error) {
      // 11000 is the unique index firing, which here means the racing twin
      // won. Its document is the right answer, so return it rather than
      // failing a workout the user has already finished.
      if (dto.clientId && (error as { code?: number })?.code === 11000) {
        const winner = await this.sessionModel
          .findOne({ userId, clientId: dto.clientId })
          .exec();
        if (winner) return winner;
      }
      throw error;
    }
  }

  /**
   * One user's sessions, newest first.
   *
   * `planId` and `dayName` narrow it to one day of one plan, which is what
   * the logger asks for when it opens: the last time this day was trained,
   * `limit: 1`. Both are indexed — `planId` by its own index, and the sort
   * rides the `{ userId, performedAt }` one.
   */
  async findByUserId(
    userId: string,
    query: ListWorkoutSessionsDto = {},
  ): Promise<WorkoutSessionDocument[]> {
    const filter: Record<string, unknown> = { userId };

    if (query.planId) filter.planId = query.planId;
    if (query.dayName) filter.dayName = query.dayName;

    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(query.from);
    if (query.to) range.$lte = new Date(query.to);
    if (Object.keys(range).length > 0) filter.performedAt = range;

    return this.sessionModel
      .find(filter)
      .sort({ performedAt: -1 })
      .limit(query.limit ?? 50)
      .exec();
  }

  async findById(id: string, caller: Caller): Promise<WorkoutSessionDocument> {
    const session = await this.getOrThrow(id);
    this.assertOwner(session, caller);
    return session;
  }

  async remove(id: string, caller: Caller): Promise<{ success: boolean }> {
    const session = await this.getOrThrow(id);
    this.assertOwner(session, caller);
    await session.deleteOne();
    return { success: true };
  }

  /**
   * Distinct calendar days on which this user logged a session, in a window.
   *
   * This is the query that used to require unwinding every training plan four
   * levels deep. Here it is an indexed range scan plus a group.
   */
  async countWorkoutDays(userId: string, since: Date): Promise<Set<string>> {
    if (!isValidObjectId(userId)) {
      return new Set();
    }

    const days = await this.sessionModel
      .aggregate<{ _id: string }>([
        {
          $match: {
            userId: new Types.ObjectId(userId),
            performedAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$performedAt' },
            },
          },
        },
      ])
      .exec();

    return new Set(days.map((d) => d._id));
  }

  // ─── internals ────────────────────────────────────────────────

  private resolvePerformedAt(value?: string): Date {
    if (!value) return new Date();
    const parsed = new Date(value);
    const now = new Date();
    return parsed.getTime() > now.getTime() ? now : parsed;
  }

  private async getOrThrow(id: string): Promise<WorkoutSessionDocument> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Workout session not found');
    }
    const session = await this.sessionModel.findById(id);
    if (!session) {
      throw new NotFoundException('Workout session not found');
    }
    return session;
  }

  /**
   * Sessions are addressed by their own id, so `@OwnsUserParam` cannot help —
   * there is no user id in the URL to compare. The check has to happen here,
   * after the document is loaded.
   */
  private assertOwner(session: WorkoutSessionDocument, caller: Caller): void {
    if (caller.role === 'admin') return;
    // getIdString rather than String(): the schema types userId as
    // string | object, and the plain conversion of an ObjectId-shaped object
    // is "[object Object]" — which would never match and would deny everyone.
    if (getIdString(session.userId) === caller.id) return;
    throw new ForbiddenException('You can only access your own workouts');
  }
}
