import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  Delete,
  ForbiddenException,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TrainingPlanService } from './training-plan.service';
import { TrainingPlan, trainingPlanSchema } from './training-plan.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import { paginationSchema } from '../../common/dto/pagination.dto';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

@Controller('training-plans')
@UseGuards(AuthGuard('jwt'), RolesGuard) // Use Passport JWT guard
export class TrainingPlanController {
  constructor(private readonly trainingPlanService: TrainingPlanService) {}
  @Post()
  @Roles('trainer', 'admin', 'user')
  async create(
    @Body(new ZodValidationPipe(trainingPlanSchema.partial()))
    data: Partial<TrainingPlan>,
    @Request() req: AuthRequest,
  ) {
    data.userId = req.user.id;
    return this.trainingPlanService.create(data);
  }

  @Get()
  @Roles('user', 'trainer', 'admin') // All authenticated users can view plans
  async findAll(
    @Request() req: AuthRequest,
    @Query(new ZodValidationPipe(paginationSchema))
    query: PaginationDto,
  ) {
    const userId = req.user.id;
    const userRole = req.user.role;

    return this.trainingPlanService.findAll(query, userId, userRole);
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  async findOne(@Param('id') id: string) {
    return this.trainingPlanService.findById(id);
  }

  @Put(':id')
  @Roles('trainer', 'admin', 'user')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(trainingPlanSchema.partial()))
    data: Partial<TrainingPlan>,
  ) {
    return this.trainingPlanService.update(id, data);
  }

  @Get('user/:userId/with-shared')
  @Roles('user', 'trainer', 'admin')
  async findByUserWithShared(@Param('userId') userId: string) {
    return this.trainingPlanService.findByUserIdWithShared(userId);
  }

  @Post(':id/share')
  @Roles('trainer', 'admin', 'user')
  async sharePlan(
    @Param('id') planId: string,
    @Body() body: { userIds: string[] },
  ) {
    if (!body.userIds || !Array.isArray(body.userIds)) {
      throw new ForbiddenException('userIds array is required');
    }
    return this.trainingPlanService.sharePlan(planId, body.userIds);
  }

  @Delete(':id/share/:userId')
  @Roles('trainer', 'admin', 'user')
  async revokeShare(
    @Param('id') planId: string,
    @Param('userId') userId: string,
  ) {
    return this.trainingPlanService.revokeShare(planId, userId);
  }

  @Get(':id/clones')
  @Roles('user', 'trainer', 'admin')
  async getChildClones(@Param('id') parentId: string) {
    return this.trainingPlanService.getChildClones(parentId);
  }

  @Post(':id/activate')
  @Roles('user', 'trainer', 'admin')
  async activateTrainingPlan(
    @Param('id') planId: string,
    @Request() req: AuthRequest,
  ) {
    const userId = req.user.id;
    return await this.trainingPlanService.activateTrainingPlan(
      planId,
      userId,
    );
  }

  @Delete(':id')
  @Roles('trainer', 'admin', 'user')
  async delete(@Param('id') id: string) {
    return this.trainingPlanService.delete(id);
  }
}
