import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TrainingPlan,
  TrainingPlanDocument,
  trainingPlanSchema,
} from './training-plan.schema';
import {
  PaginationDto,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { ObjectId } from 'mongodb';
import { getIdString } from '../../utils/helpers';
import {
  buildSortQuery,
  validateData,
  handleMongoError,
} from '../../utils/mongo.helpers';

@Injectable()
export class TrainingPlanService {
  constructor(
    @InjectModel('TrainingPlan')
    private trainingPlanModel: Model<TrainingPlanDocument>,
  ) {}

  async create(data: Partial<TrainingPlan>): Promise<TrainingPlanDocument> {
    try {
      const validatedData = validateData(trainingPlanSchema.partial(), data);
      const plan = new this.trainingPlanModel(validatedData);
      return await plan.save();
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

    // Build filter based on user role
    let filter: Record<string, any> = {};
    if (userRole === 'admin') {
      // Admin can see all parent plans (no clones)
      filter = { initialParentId: { $exists: false } };
    } else if (userRole === 'trainer') {
      // Trainer can see plans they created or plans shared with them (their clones)
      filter = {
        $or: [
          { trainerId: userId, initialParentId: { $exists: false } }, // Plans they created as trainer (parents only)
          { userId: userId }, // Plans owned by them (includes clones they received)
        ],
      };
      console.log(
        'Trainer user - fetching plans created by or clones owned by:',
        userId,
      );
    } else {
      // Regular user can see plans assigned to them (includes clones they received)
      // Exclude plans where they are the original creator but it's a clone of someone else's plan
      filter = {
        userId: userId,
      };
      console.log('Regular user - fetching plans owned by:', userId);
    }

    const [plans, total] = await Promise.all([
      this.trainingPlanModel
        .find(filter)
        .populate('trainerId', 'fullName email')
        .populate('userId', 'fullName email')
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.trainingPlanModel.countDocuments(filter),
    ]);

    console.log(
      `Found ${plans.length} training plans for user ${userId} (role: ${userRole})`,
    );

    return {
      items: plans.map((plan) => plan.toObject()),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async findById(id: string): Promise<TrainingPlan> {
    try {
      const plan = await this.trainingPlanModel.findById(id).exec();
      if (!plan) throw new NotFoundException('Training plan not found');
      return plan.toObject();
    } catch (error) {
      handleMongoError(error);
    }
  }

  async update(id: string, data: Partial<TrainingPlan>): Promise<TrainingPlan> {
    try {
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
        await this.syncSharedAccess(id, data.sharedAccess);
      }

      // If syncWithParent is enabled and this is a parent plan, sync to children
      if (updated.syncWithParent !== false && !updated.initialParentId) {
        await this.syncToChildren(id, updated.toObject());
      }

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
      console.error('Error syncing shared access:', error);
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
      console.error('Error syncing to children:', error);
      // Don't throw - parent update should succeed even if child sync fails
    }
  }

  async delete(id: string): Promise<{ message: string }> {
    try {
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
        .sort({ createdAt: -1 })
        .exec();
      return plans.map((plan) => plan.toObject());
    } catch (error) {
      handleMongoError(error);
    }
  }

  async sharePlan(planId: string, userIds: string[]): Promise<TrainingPlan[]> {
    try {
      const originalPlan = await this.trainingPlanModel.findById(planId).exec();
      if (!originalPlan) throw new NotFoundException('Training plan not found');

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

  async revokeShare(planId: string, userId: string): Promise<TrainingPlan> {
    try {
      const plan = await this.trainingPlanModel
        .findByIdAndUpdate(
          planId,
          { $pull: { sharedWith: userId } },
          { new: true },
        )
        .populate('userId', 'fullName email')
        .populate('trainerId', 'fullName email')
        .populate('sharedWith', 'fullName email')
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

  async getChildClones(parentId: string): Promise<TrainingPlan[]> {
    try {
      const clones = await this.trainingPlanModel
        .find({ initialParentId: parentId })
        .populate('userId', 'fullName email')
        .sort({ createdAt: -1 })
        .exec();
      return clones.map((clone) => clone.toObject());
    } catch (error) {
      handleMongoError(error);
    }
  }
}
