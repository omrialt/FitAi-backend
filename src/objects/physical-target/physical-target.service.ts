import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PhysicalTarget,
  PhysicalTargetDocument,
  PhysicalTargetValues,
} from './physical-target.schema';
import { PhysicalDataDocument } from '../physical-data/physical-data.schema';
import { PhysicalDataService } from '../physical-data/physical-data.service';
import { CreatePhysicalTargetDto } from '../../interfaces/physical-target.interfaces';
import { handleMongoError } from '../../utils/mongo.helpers';
import {
  assertOwnerOrAdmin,
  isOwnerOrAdmin,
  toIdString,
  type Requester,
} from '../../utils/ownership';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';

type TargetMetric = keyof PhysicalTargetValues;
const TARGET_METRICS: TargetMetric[] = [
  'weightKg',
  'bodyFatPercent',
  'chest',
  'waist',
  'hips',
  'arms',
  'legs',
];

export interface MetricProgress {
  metric: TargetMetric;
  start: number | null;
  current: number | null;
  target: number;
  percentComplete: number;
}

export interface TargetProgress {
  targetId: string;
  name?: string;
  targetDate: Date;
  daysRemaining: number;
  status: string;
  metrics: MetricProgress[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads a target metric's current value off a physical-data record. */
function readMetric(
  record: PhysicalDataDocument | null,
  metric: TargetMetric,
): number | null {
  if (!record) return null;
  if (metric === 'weightKg' || metric === 'bodyFatPercent') {
    return record[metric] ?? null;
  }
  return record.measurements?.[metric] ?? null;
}

@Injectable()
export class PhysicalTargetService {
  constructor(
    @InjectModel('PhysicalTarget')
    private physicalTargetModel: Model<PhysicalTargetDocument>,
    private readonly physicalDataService: PhysicalDataService,
    private readonly trainerAccess: TrainerAccessService,
  ) {}

  /**
   * A target for `createDto.userId`, set by `requester`.
   *
   * Usually the same person. A trainer may set one for a client — but only
   * while the client's acceptance of them stands, checked here on every call,
   * so a revoked connection stops it at once. The target is still the
   * client's: `userId` is theirs, the starting values are read from *their*
   * latest measurement, and `createdBy` only records who wrote it.
   */
  async create(
    createDto: CreatePhysicalTargetDto & { userId: string },
    requester?: Requester,
  ): Promise<PhysicalTargetDocument> {
    if (requester && requester.id !== createDto.userId) {
      const allowed =
        requester.role === 'admin' ||
        (requester.role === 'trainer' &&
          (await this.trainerAccess.isAcceptedTrainerOf(
            requester.id,
            createDto.userId,
          )));
      if (!allowed) {
        throw new ForbiddenException(
          'You can only set targets for yourself or for your own clients',
        );
      }
    }

    const targetMetrics = TARGET_METRICS.filter(
      (metric) => createDto.targetValues[metric] !== undefined,
    );
    if (targetMetrics.length === 0) {
      throw new BadRequestException(
        'At least one target metric must be provided',
      );
    }

    try {
      // Snapshot the latest physical-data reading for every metric this
      // target covers, so progress can later be measured from "where the
      // user started" rather than only "where they ended up".
      const latest = await this.physicalDataService.findLatestByUserId(
        createDto.userId,
      );
      const startValues: Partial<PhysicalTargetValues> = {};
      for (const metric of targetMetrics) {
        const value = readMetric(latest, metric);
        if (value !== null) startValues[metric] = value;
      }

      const physicalTarget = new this.physicalTargetModel({
        ...createDto,
        userId: new Types.ObjectId(createDto.userId),
        targetDate: new Date(createDto.targetDate),
        startValues,
        createdBy: new Types.ObjectId(requester?.id ?? createDto.userId),
      });
      return await physicalTarget.save();
    } catch (error) {
      handleMongoError(error);
    }
  }

  async findByUserId(
    userId: string,
    status?: string,
  ): Promise<PhysicalTargetDocument[]> {
    return this.physicalTargetModel
      .find({
        userId: new Types.ObjectId(userId),
        ...(status ? { status } : {}),
      })
      .sort({ targetDate: 1 })
      .exec();
  }

  async findById(
    id: string,
    requester?: Requester,
  ): Promise<PhysicalTargetDocument> {
    try {
      const physicalTarget = await this.physicalTargetModel.findById(id).exec();
      if (!physicalTarget) {
        throw new NotFoundException(`Physical target with ID ${id} not found`);
      }
      if (requester) {
        assertOwnerOrAdmin(physicalTarget.userId, requester, 'target');
      }
      return physicalTarget;
    } catch (error) {
      handleMongoError(error);
    }
  }

  async update(
    id: string,
    data: Partial<PhysicalTarget>,
    requester?: Requester,
  ): Promise<PhysicalTargetDocument> {
    try {
      if (requester) {
        await this.assertCanModify(id, requester);
      }

      // A goal that is closed remembers when, so the card can say "achieved
      // on 3 Oct" instead of only "achieved"; reopening it forgets that.
      const update: Record<string, unknown> = { ...data };
      if (data.status === 'active') {
        update.$unset = { closedAt: 1 };
      } else if (data.status !== undefined) {
        update.closedAt = new Date();
      }

      const physicalTarget = await this.physicalTargetModel
        .findByIdAndUpdate(id, update, { new: true, runValidators: true })
        .exec();
      if (!physicalTarget) {
        throw new NotFoundException(`Physical target with ID ${id} not found`);
      }
      return physicalTarget;
    } catch (error) {
      return handleMongoError(error);
    }
  }

  async remove(
    id: string,
    requester?: Requester,
  ): Promise<PhysicalTargetDocument> {
    try {
      if (requester) {
        await this.assertCanModify(id, requester);
      }

      const physicalTarget = await this.physicalTargetModel
        .findByIdAndDelete(id)
        .exec();
      if (!physicalTarget) {
        throw new NotFoundException(`Physical target with ID ${id} not found`);
      }
      return physicalTarget;
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Progress of every target, closed ones included.
   *
   * It used to be active targets only — harmless while nothing could close a
   * target. Once one can, an achieved goal would lose its bars the moment it
   * was marked achieved, which is the opposite of what the user wants to see.
   */
  async getProgress(userId: string): Promise<TargetProgress[]> {
    const [targets, latest] = await Promise.all([
      this.findByUserId(userId),
      this.physicalDataService.findLatestByUserId(userId),
    ]);

    const now = Date.now();
    return targets.map((target) => {
      const metrics: MetricProgress[] = TARGET_METRICS.filter(
        (metric) => target.targetValues[metric] !== undefined,
      ).map((metric) => {
        const start = target.startValues?.[metric] ?? null;
        const current = readMetric(latest, metric);
        const targetValue = target.targetValues[metric] as number;
        const percentComplete = computePercentComplete(
          start,
          current,
          targetValue,
        );
        return { metric, start, current, target: targetValue, percentComplete };
      });

      return {
        targetId: target._id.toString(),
        name: target.name,
        targetDate: target.targetDate,
        daysRemaining: Math.ceil((target.targetDate.getTime() - now) / DAY_MS),
        status: target.status,
        metrics,
      };
    });
  }

  /**
   * Who may change a target: its owner, an admin, or the trainer who set it —
   * the last only while still the owner's accepted trainer. A trainer never
   * gets to edit a target the client set for themselves; that one is the
   * client's own decision about their own body.
   */
  private async assertCanModify(
    id: string,
    requester: Requester,
  ): Promise<void> {
    const existing = await this.physicalTargetModel
      .findById(id)
      .select('userId createdBy')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException(`Physical target with ID ${id} not found`);
    }
    if (isOwnerOrAdmin(existing.userId, requester)) return;

    const ownerId = toIdString(existing.userId);
    if (
      requester.role === 'trainer' &&
      ownerId &&
      toIdString(existing.createdBy) === requester.id &&
      (await this.trainerAccess.isAcceptedTrainerOf(requester.id, ownerId))
    ) {
      return;
    }
    assertOwnerOrAdmin(existing.userId, requester, 'target');
  }
}

/** Percent of the distance from `start` to `target` that `current` has covered, clamped to [0, 100]. */
export function computePercentComplete(
  start: number | null,
  current: number | null,
  target: number,
): number {
  if (current === null) return 0;
  if (start === null || start === target) {
    return current === target ? 100 : 0;
  }
  const percent = ((current - start) / (target - start)) * 100;
  return Math.max(0, Math.min(100, Math.round(percent)));
}
