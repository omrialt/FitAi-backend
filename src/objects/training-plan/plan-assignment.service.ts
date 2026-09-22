import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { TrainerAccessService } from '../../common/trainer-access/trainer-access.service';
import type {
  TrainingPlan,
  TrainingPlanDocument,
} from './training-plan.schema';
import { getIdString } from '../../utils/helpers';

export type AssignmentStatus = 'created' | 'skipped' | 'failed';

export type AssignmentReason =
  /** Not an accepted client of the caller. */
  | 'not_your_client'
  /** Already has a live plan cloned from this template. */
  | 'already_assigned'
  /** The write itself failed. */
  | 'write_failed';

export interface AssignmentResult {
  clientId: string;
  status: AssignmentStatus;
  planId?: string;
  reason?: AssignmentReason;
}

export interface AssignOptions {
  startDate?: Date;
  syncWithParent?: boolean;
  /** Assign again to a client who already has this template. */
  force?: boolean;
}

/**
 * One template, many clients.
 *
 * The shape of the result is the design decision worth stating. A batch that
 * throws on client #7 has already written six plans and tells the caller
 * nothing about which — so nothing here throws for a per-client problem.
 * Every client gets a row saying what happened to them, and the request
 * succeeds as a whole even when some rows did not.
 *
 * The copy strips everything performed. A template carries intent — target
 * reps and weights — and copying one person's performed sets into another
 * person's plan would be inventing training history for someone who never did
 * it. That is the same rule `sharePlan` follows, for the same reason.
 */
@Injectable()
export class PlanAssignmentService {
  private readonly logger = new Logger(PlanAssignmentService.name);

  constructor(
    @InjectModel('TrainingPlan')
    private readonly planModel: Model<TrainingPlanDocument>,
    private readonly trainerAccess: TrainerAccessService,
  ) {}

  /** The caller's own templates, newest first. */
  async listLibrary(ownerId: string): Promise<TrainingPlan[]> {
    if (!isValidObjectId(ownerId)) return [];

    const templates = await this.planModel
      .find({ userId: ownerId, isTemplate: true })
      .sort({ createdAt: -1 })
      .exec();

    return templates.map((template) => template.toObject());
  }

  /**
   * Copy an existing plan into the caller's library.
   *
   * A copy, not a flag flipped on the original: the plan a client is training
   * right now must not stop being their plan because the trainer decided it
   * was a good pattern.
   */
  async saveAsTemplate(
    planId: string,
    ownerId: string,
    title?: string,
  ): Promise<TrainingPlan> {
    const source = await this.loadOwned(planId, ownerId);

    const template = new this.planModel({
      ...this.copyableFields(source),
      title: title?.trim() || source.title,
      userId: ownerId,
      trainerId: ownerId,
      isTemplate: true,
      isActive: false,
      activeByUsers: [],
      sharedWith: [],
      sharedAccess: [],
      initialParentId: null,
      syncWithParent: false,
      startDate: undefined,
      endDate: null,
    });

    const saved = await template.save();
    this.logger.debug(`Trainer ${ownerId} saved template ${getIdString(saved._id)}`);
    return saved.toObject();
  }

  /** Hand the template to each client, one row of outcome per client. */
  async assign(
    templateId: string,
    trainerId: string,
    clientIds: string[],
    options: AssignOptions = {},
  ): Promise<AssignmentResult[]> {
    const template = await this.loadOwned(templateId, trainerId);

    // One query for the roster rather than one per client, and it is the same
    // accepted-connection source every other permission check reads.
    const roster = new Set(await this.trainerAccess.listClientIds(trainerId));

    // Also one query: who already holds a copy of this template.
    const existing = await this.planModel
      .find({ initialParentId: templateId, userId: { $in: [...roster] } })
      .select('userId')
      .lean<{ userId: unknown }[]>()
      .exec();
    const alreadyAssigned = new Set(
      existing.map((plan) => getIdString(plan.userId)),
    );

    const results: AssignmentResult[] = [];
    // Duplicates in the request would otherwise create two plans for one
    // person in a single call, before `alreadyAssigned` had a chance to know.
    for (const clientId of [...new Set(clientIds)]) {
      if (!roster.has(clientId)) {
        results.push({
          clientId,
          status: 'skipped',
          reason: 'not_your_client',
        });
        continue;
      }

      if (alreadyAssigned.has(clientId) && !options.force) {
        results.push({
          clientId,
          status: 'skipped',
          reason: 'already_assigned',
        });
        continue;
      }

      try {
        const clone = new this.planModel({
          ...this.copyableFields(template),
          userId: clientId,
          trainerId,
          isTemplate: false,
          isActive: true,
          activeByUsers: [],
          sharedWith: [],
          sharedAccess: [],
          initialParentId: templateId,
          syncWithParent: options.syncWithParent ?? false,
          startDate: options.startDate,
          endDate: null,
        });

        const saved = await clone.save();
        alreadyAssigned.add(clientId);
        results.push({
          clientId,
          status: 'created',
          planId: getIdString(saved._id),
        });
      } catch (error) {
        // One client's failure is that client's row, not the batch's.
        this.logger.error(
          `Assigning ${templateId} to ${clientId} failed`,
          error instanceof Error ? error.stack : String(error),
        );
        results.push({ clientId, status: 'failed', reason: 'write_failed' });
      }
    }

    return results;
  }

  // ─── helpers ──────────────────────────────────────────────────

  private async loadOwned(
    planId: string,
    ownerId: string,
  ): Promise<TrainingPlanDocument> {
    if (!isValidObjectId(planId)) {
      throw new NotFoundException('Training plan not found');
    }

    const plan = await this.planModel.findById(planId).exec();
    if (!plan) throw new NotFoundException('Training plan not found');

    if (getIdString(plan.userId) !== ownerId) {
      throw new ForbiddenException('This plan is not yours');
    }

    return plan;
  }

  /**
   * The parts of a plan that describe the training, with every trace of who
   * performed it removed.
   */
  private copyableFields(source: TrainingPlanDocument) {
    const plan = source.toObject();

    return {
      title: plan.title,
      description: plan.description,
      difficulty: plan.difficulty,
      target: plan.target,
      programType: plan.programType,
      rotationCycleLength: plan.rotationCycleLength,
      focus: plan.focus,
      estimatedDuration: plan.estimatedDuration,
      estimatedCalories: plan.estimatedCalories,
      days: (plan.days ?? []).map((day) => ({
        dayName: day.dayName,
        dayOfWeek: day.dayOfWeek,
        // Dropped on purpose: a date is when *that* client was going to train.
        exercises: (day.exercises ?? []).map((exercise) => ({
          name: exercise.name,
          muscleGroup: exercise.muscleGroup,
          type: exercise.type,
          supersetGroupId: exercise.supersetGroupId,
          notes: exercise.notes,
          video: exercise.video,
          sets: (exercise.sets ?? []).map((set) => ({
            targetReps: set.targetReps,
            targetWeight: set.targetWeight,
            // No performedReps, no performedWeight, no history.
            history: [],
          })),
        })),
      })),
    };
  }
}
