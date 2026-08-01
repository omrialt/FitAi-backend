import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TrainingPlan,
  TrainingPlanDocument,
  trainingPlanSchema,
} from './training-plan.schema';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PaginatedResponse } from '../../interfaces/pagination.interfaces';
import { ObjectId } from 'mongodb';
import { getIdString } from '../../utils/helpers';
import {
  buildSortQuery,
  validateData,
  handleMongoError,
} from '../../utils/mongo.helpers';
import { CurrentStatusService } from '../current-status/current-status.service';
import { CalendarSyncService } from '../calendar-sync/calendar-sync.service';
import {
  isInUserList,
  isOwnerOrAdmin,
  toIdString,
  type Requester,
} from '../../utils/ownership';

@Injectable()
export class TrainingPlanService {
  private readonly logger = new Logger(TrainingPlanService.name);

  constructor(
    @InjectModel('TrainingPlan')
    private trainingPlanModel: Model<TrainingPlanDocument>,
    private currentStatusService: CurrentStatusService,
    @Inject(forwardRef(() => CalendarSyncService))
    private calendarSyncService: CalendarSyncService,
  ) {}

  async create(data: Partial<TrainingPlan>): Promise<TrainingPlanDocument> {
    try {
      data.trainerId = data.userId;

      const validatedData = validateData(trainingPlanSchema, data);
      const safeData = structuredClone(validatedData);
      const plan = new this.trainingPlanModel(safeData);

      const savedPlan = await plan.save();

      if (
        data.sharedAccess &&
        Array.isArray(data.sharedAccess) &&
        data.sharedAccess.length > 0
      ) {
        const planId = getIdString(savedPlan._id);

        await this.syncSharedAccess(
          planId,
          data.sharedAccess as Array<{
            userId: string;
            accessLevel: string;
            objectType: string;
          }>,
        );
      }

      return savedPlan;
    } catch (error) {
      handleMongoError(error);
    }
  }

  async findAll(
    query: PaginationDto,
    userId: string,
    userRole: string,
  ): Promise<PaginatedResponse<TrainingPlan>> {
    const { page = 1, limit = 10, sort, order = 'asc' } = query;
    const skip = (page - 1) * limit;
    const sortQuery = buildSortQuery(sort, order);

    let filter: Record<string, any> = {};
    if (userRole === 'admin') {
      filter = { initialParentId: { $exists: false } };
    } else if (userRole === 'trainer') {
      filter = {
        $or: [
          { trainerId: userId, initialParentId: { $exists: false } },
          { userId: userId },
        ],
      };
    } else {
      filter = {
        userId: userId,
      };
    }

    const [plans, total] = await Promise.all([
      this.trainingPlanModel
        .find(filter)
        .populate('trainerId', 'fullName email')
        .populate('userId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.trainingPlanModel.countDocuments(filter),
    ]);

    return {
      items: plans.map((plan) => plan.toObject()),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async findById(id: string, requester?: Requester): Promise<TrainingPlan> {
    try {
      const plan = await this.trainingPlanModel
        .findById(id)
        .populate('userId', 'fullName email')
        .populate('trainerId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .exec();
      if (!plan) throw new NotFoundException('Training plan not found');
      if (requester && !this.canRead(plan, requester)) {
        throw new ForbiddenException(
          'You do not have access to this training plan',
        );
      }
      return plan.toObject();
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Read access: the owner, the trainer who authored it, anyone it was shared
   * with, anyone currently running it, and admins.
   *
   * Sharing deep-clones a plan, so a recipient is normally the *owner* of their
   * own copy — the shared/active lists are here for the parent plan, which a
   * trainer's client can still legitimately open.
   */
  private canRead(
    plan: Pick<
      TrainingPlanDocument,
      'userId' | 'trainerId' | 'sharedWith' | 'activeByUsers' | 'sharedAccess'
    >,
    requester: Requester,
  ): boolean {
    if (isOwnerOrAdmin(plan.userId, requester)) return true;
    if (toIdString(plan.trainerId) === requester.id) return true;
    if (isInUserList(plan.sharedWith, requester.id)) return true;
    if (isInUserList(plan.activeByUsers, requester.id)) return true;
    return (plan.sharedAccess ?? []).some(
      (entry) => toIdString(entry?.userId) === requester.id,
    );
  }

  /**
   * Write access is deliberately narrower than read access: owner, admin, or
   * someone granted an explicit `edit` share. A plain viewer must not be able
   * to edit or delete a plan they were only shown.
   */
  private canWrite(
    plan: Pick<TrainingPlanDocument, 'userId' | 'sharedAccess'>,
    requester: Requester,
  ): boolean {
    if (isOwnerOrAdmin(plan.userId, requester)) return true;
    return (plan.sharedAccess ?? []).some(
      (entry) =>
        toIdString(entry?.userId) === requester.id &&
        entry?.accessLevel === 'edit',
    );
  }

  /** Load a plan and assert the requester may modify it. */
  private async assertCanWrite(
    id: string,
    requester: Requester,
  ): Promise<void> {
    const plan = await this.trainingPlanModel
      .findById(id)
      .select('userId sharedAccess')
      .lean()
      .exec();
    if (!plan) throw new NotFoundException('Training plan not found');
    if (!this.canWrite(plan as unknown as TrainingPlanDocument, requester)) {
      throw new ForbiddenException(
        'You do not have permission to modify this training plan',
      );
    }
  }

  async update(
    id: string,
    data: Partial<TrainingPlan>,
    requester?: Requester,
  ): Promise<TrainingPlan> {
    try {
      if (requester) {
        await this.assertCanWrite(id, requester);
      }
      const validatedData = validateData(trainingPlanSchema.partial(), data);
      // Get the current plan before updating
      const currentPlan = await this.trainingPlanModel.findById(id).exec();
      if (!currentPlan) throw new NotFoundException('Training plan not found');

      const updated = await this.trainingPlanModel
        .findByIdAndUpdate(id, validatedData, {
          new: true,
          runValidators: true,
        })
        .exec();
      if (!updated) throw new NotFoundException('Training plan not found');

      // Handle sharedAccess changes - create/update/delete clones
      if (data.sharedAccess) {
        await this.syncSharedAccess(
          id,
          data.sharedAccess.map((sa) => ({
            ...sa,
            userId: getIdString(sa.userId),
          })),
        );
      }

      // If syncWithParent is enabled and this is a parent plan, sync to children
      if (updated.syncWithParent !== false && !updated.initialParentId) {
        await this.syncToChildren(id, updated.toObject());
      }

      // Auto-sync to Google Calendar for users who have this plan active
      this.triggerGoogleCalendarSync(id).catch(() => {});

      return updated.toObject();
    } catch (error) {
      handleMongoError(error);
    }
  }

  private async syncSharedAccess(
    parentId: string,
    sharedAccess: Array<{
      userId: string;
      accessLevel: string;
      objectType: string;
    }>,
  ): Promise<void> {
    try {
      // Get current userIds from sharedAccess array
      const targetUserIds = sharedAccess.map((sa) => sa.userId);

      // Find existing clones
      const existingClones = await this.trainingPlanModel
        .find({ initialParentId: parentId })
        .exec();

      const existingCloneUserIds = existingClones.map((clone) =>
        getIdString(clone.userId),
      );

      // Determine which users need clones created
      const usersToAdd = targetUserIds.filter(
        (userId) => !existingCloneUserIds.includes(userId),
      );

      // Determine which clones need to be deleted
      const usersToRemove = existingCloneUserIds.filter(
        (userId) => !targetUserIds.includes(userId),
      );

      // Create new clones for users that were added
      if (usersToAdd.length > 0) {
        await this.sharePlan(parentId, usersToAdd);
      }

      // Delete clones for users that were removed
      if (usersToRemove.length > 0) {
        for (const userId of usersToRemove) {
          const cloneToDelete = existingClones.find(
            (clone) => getIdString(clone.userId) === userId,
          );
          if (cloneToDelete) {
            await this.trainingPlanModel
              .findByIdAndDelete(cloneToDelete._id)
              .exec();
          }
        }
      }
    } catch (error) {
      this.logger.error(
        'Error syncing shared access',
        error instanceof Error ? error.stack : String(error),
      );
      // Don't throw - parent update should succeed even if clone sync fails
    }
  }

  private async syncToChildren(
    parentId: string,
    updates: Partial<TrainingPlan>,
  ): Promise<void> {
    try {
      // Find all children that have syncWithParent enabled
      const children = await this.trainingPlanModel
        .find({
          initialParentId: new ObjectId(parentId),
        })
        .exec();

      for (const child of children) {
        const syncUpdates: Partial<TrainingPlan> = {};

        // Sync specific fields, excluding user-specific data
        if (updates.title) syncUpdates.title = updates.title;
        if (updates.description) syncUpdates.description = updates.description;
        if (updates.difficulty) syncUpdates.difficulty = updates.difficulty;
        if (updates.programType) syncUpdates.programType = updates.programType;
        if (updates.focus) syncUpdates.focus = updates.focus;
        if (updates.estimatedDuration)
          syncUpdates.estimatedDuration = updates.estimatedDuration;
        if (updates.estimatedCalories)
          syncUpdates.estimatedCalories = updates.estimatedCalories;
        if (updates.rotationCycleLength)
          syncUpdates.rotationCycleLength = updates.rotationCycleLength;

        // Sync days/exercises/sets but preserve the child's history
        if (updates.days) {
          const childDays = child.days;
          const syncedDays = updates.days.map((newDay, dayIndex) => {
            const existingDay = childDays[dayIndex];
            return {
              ...newDay,
              exercises: newDay.exercises.map((newExercise, exIndex) => {
                const existingExercise = existingDay?.exercises[exIndex];
                return {
                  ...newExercise,
                  sets: newExercise.sets.map((newSet, setIndex) => {
                    const existingSet = existingExercise?.sets[setIndex];
                    return {
                      targetReps: newSet.targetReps,
                      targetWeight: newSet.targetWeight,
                      // Preserve child's history and performed values
                      history: existingSet?.history || [],
                      performedReps: existingSet?.performedReps,
                      performedWeight: existingSet?.performedWeight,
                    };
                  }),
                };
              }),
            };
          });
          syncUpdates.days = syncedDays;
        }

        if (Object.keys(syncUpdates).length > 0) {
          await this.trainingPlanModel
            .findByIdAndUpdate(child._id, syncUpdates)
            .exec();
        }
      }
    } catch (error) {
      this.logger.error(
        'Error syncing to children',
        error instanceof Error ? error.stack : String(error),
      );
      // Don't throw - parent update should succeed even if child sync fails
    }
  }

  /**
   * Trigger Google Calendar sync for all users who have the given plan
   * (or its children) as their active plan. Fire-and-forget.
   */
  private async triggerGoogleCalendarSync(planId: string): Promise<void> {
    try {
      // Find the plan and its children
      const plan = await this.trainingPlanModel.findById(planId).exec();
      if (!plan) return;

      // Collect user IDs from activeByUsers of this plan
      const userIds = new Set<string>(
        (plan.activeByUsers || []).map((uid) => getIdString(uid)),
      );

      // Also check children (coach scenario: parent update syncs to children)
      const children = await this.trainingPlanModel
        .find({ initialParentId: planId })
        .exec();

      for (const child of children) {
        for (const uid of child.activeByUsers || []) {
          userIds.add(getIdString(uid));
        }
      }

      // Sync each affected user's calendar
      for (const userId of userIds) {
        await this.calendarSyncService.syncUserIfConnected(userId);
      }
    } catch (error) {
      this.logger.error(
        'Auto Google Calendar sync failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async delete(
    id: string,
    requester?: Requester,
  ): Promise<{ message: string }> {
    try {
      if (requester) {
        await this.assertCanWrite(id, requester);
      }
      await this.trainingPlanModel.findByIdAndDelete(id).exec();
      return { message: 'Training plan deleted successfully' };
    } catch (error) {
      handleMongoError(error);
    }
  }

  async findByUserIdWithShared(userId: string): Promise<TrainingPlan[]> {
    try {
      const plans = await this.trainingPlanModel
        .find({
          $or: [{ userId }, { sharedWith: userId }],
        })
        .populate('userId', 'fullName email')
        .populate('trainerId', 'fullName email')
        .populate('sharedWith', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .sort({ createdAt: -1 })
        .exec();
      return plans.map((plan) => plan.toObject());
    } catch (error) {
      handleMongoError(error);
    }
  }

  async sharePlan(
    planId: string,
    userIds: string[],
    requester?: Requester,
  ): Promise<TrainingPlan[]> {
    try {
      const originalPlan = await this.trainingPlanModel.findById(planId).exec();
      if (!originalPlan) throw new NotFoundException('Training plan not found');
      // Sharing hands a copy of the plan to another account, so it is an
      // owner-level action rather than a read.
      if (requester && !isOwnerOrAdmin(originalPlan.userId, requester)) {
        throw new ForbiddenException(
          'Only the owner can share this training plan',
        );
      }

      const createdClones: TrainingPlan[] = [];

      for (const userId of userIds) {
        // Create deep clone of the plan
        const planObject = originalPlan.toObject();

        // Remove fields that shouldn't be cloned
        const { ...cloneData } = planObject;

        delete (cloneData as TrainingPlan)._id; // Remove _id for new document
        delete (cloneData as TrainingPlan).createdAt; // Remove createdAt for new document
        delete (cloneData as TrainingPlan).updatedAt; // Remove updatedAt for new document // Remove __v for new document
        // Deep clone days and exercises, removing history from sets
        const clonedDays = cloneData.days.map((day) => ({
          ...day,
          exercises: day.exercises.map((exercise) => ({
            ...exercise,
            sets: exercise.sets.map((set) => ({
              targetReps: set.targetReps,
              targetWeight: set.targetWeight,
              history: [], // Empty history for clones
            })),
          })),
        }));

        // Create the cloned plan with new owner
        const clonedPlan = new this.trainingPlanModel({
          ...cloneData,
          userId: userId, // New owner
          trainerId: originalPlan.userId, // Original creator becomes trainer
          initialParentId: planId, // Track the parent
          syncWithParent: false, // Default to not synced
          days: clonedDays,
          sharedWith: [], // Clone doesn't inherit shares
          sharedAccess: [], // Clone doesn't inherit access
        });

        const saved = await clonedPlan.save();
        createdClones.push(saved.toObject());
      }

      return createdClones;
    } catch (error) {
      handleMongoError(error);
    }
  }

  async revokeShare(
    planId: string,
    userId: string,
    requester?: Requester,
  ): Promise<TrainingPlan> {
    try {
      if (requester) {
        await this.assertCanWrite(planId, requester);
      }
      const plan = await this.trainingPlanModel
        .findByIdAndUpdate(
          planId,
          { $pull: { sharedWith: userId } },
          { new: true },
        )
        .populate('userId', 'fullName email')
        .populate('trainerId', 'fullName email')
        .populate('sharedWith', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .exec();
      if (!plan) throw new NotFoundException('Training plan not found');
      return plan.toObject();
    } catch (error) {
      handleMongoError(error);
    }
  }

  async hasAccessToPlan(
    planId: string,
    currentUserId: string,
  ): Promise<boolean> {
    try {
      const plan = await this.trainingPlanModel.findById(planId).exec();
      if (!plan) return false;
      const userIdStr = getIdString(plan.userId);
      const sharedWithIds = (plan.sharedWith || []).map((id) =>
        getIdString(id),
      );
      return (
        userIdStr === currentUserId || sharedWithIds.includes(currentUserId)
      );
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getChildClones(
    parentId: string,
    requester?: Requester,
  ): Promise<TrainingPlan[]> {
    try {
      // Clones name the people a plan was shared with, so only the parent
      // plan's owner may enumerate them.
      if (requester) {
        const parent = await this.trainingPlanModel
          .findById(parentId)
          .select('userId')
          .lean()
          .exec();
        if (!parent) throw new NotFoundException('Training plan not found');
        if (!isOwnerOrAdmin(parent.userId, requester)) {
          throw new ForbiddenException(
            'You do not have access to this training plan',
          );
        }
      }

      const clones = await this.trainingPlanModel
        .find({ initialParentId: parentId })
        .populate('userId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .sort({ createdAt: -1 })
        .exec();
      return clones.map((clone) => clone.toObject());
    } catch (error) {
      handleMongoError(error);
    }
  }

  async activateTrainingPlan(
    planId: string,
    userId: string,
  ): Promise<TrainingPlan> {
    try {
      const plan = await this.trainingPlanModel.findById(planId).exec();

      if (!plan) {
        throw new NotFoundException(
          `Training plan with ID ${planId} not found`,
        );
      }

      // First, set isActive to false for all plans owned by this user
      await this.trainingPlanModel
        .updateMany(
          { userId: new ObjectId(userId) },
          { $set: { isActive: false } },
        )
        .exec();

      // Remove user from activeByUsers in ALL plans
      await this.trainingPlanModel
        .updateMany({}, { $pull: { activeByUsers: new ObjectId(userId) } })
        .exec();

      // Then set the selected plan as active and add user to activeByUsers
      await this.trainingPlanModel
        .findByIdAndUpdate(planId, {
          $set: { isActive: true },
          $addToSet: { activeByUsers: new ObjectId(userId) },
        })
        .exec();

      // Update current status with activeTrainingPlanId
      await this.currentStatusService.setActiveTrainingPlan(userId, {
        activeTrainingPlanId: planId,
      });

      // Return populated plan
      const updatedPlan = await this.trainingPlanModel
        .findById(planId)
        .populate('userId', 'fullName email')
        .populate('trainerId', 'fullName email')
        .populate('activeByUsers', 'fullName email')
        .exec();

      if (!updatedPlan) {
        throw new NotFoundException(
          `Training plan with ID ${planId} not found after update`,
        );
      }

      // Auto-sync new active plan to Google Calendar
      this.calendarSyncService.syncUserIfConnected(userId).catch(() => {});

      return updatedPlan.toObject();
    } catch (error) {
      handleMongoError(error);
    }
  }
}
