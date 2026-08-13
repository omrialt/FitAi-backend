import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NutritionPlanService } from './nutrition-plan.service';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import { paginationSchema } from '../../common/dto/pagination.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserOwnershipGuard } from '../../common/guards/ownership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnsUserParam } from '../../common/decorators/owns-user-param.decorator';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import type { Requester } from '../../utils/ownership';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  nutritionPlanSchema,
  type NutritionPlan,
} from './nutrition-plan.schema';
import { z } from 'zod';

// Request-body schemas: strip fields clients must not set directly.
// Ratings/sharing/activation are managed by their dedicated endpoints.
const nutritionPlanCreateBodySchema = nutritionPlanSchema.partial().omit({
  ratings: true,
  averageRating: true,
  totalRatings: true,
  sharedWith: true,
  sharedAccess: true,
  activeByUsers: true,
});
const nutritionPlanUpdateBodySchema = nutritionPlanCreateBodySchema.omit({
  userId: true,
});
const shareBodySchema = z.object({
  userIds: z.array(z.string()).min(1),
});
const ratingBodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

/** `req.user` reduced to what an access decision needs. */
const requesterOf = (req: AuthRequest): Requester => ({
  id: req.user.id,
  role: req.user.role,
});

@Controller('nutrition-plans')
// UserOwnershipGuard was missing here while every other data controller
// mounted it, so `:userId` routes served any account's plans to any caller and
// the `:id` routes let anyone read, edit or delete any plan. `@Roles` answers
// "is this a user?", never "is this yours?".
@UseGuards(AuthGuard('jwt'), RolesGuard, UserOwnershipGuard)
export class NutritionPlanController {
  constructor(private readonly nutritionPlanService: NutritionPlanService) {}

  @Post()
  @Roles('trainer', 'admin', 'user')
  async create(
    @Body(new ZodValidationPipe(nutritionPlanCreateBodySchema))
    data: Partial<NutritionPlan>,
    @Request() req: AuthRequest,
  ) {
    data.userId = req.user.id;
    return this.nutritionPlanService.create(data);
  }

  @Get()
  @Roles('user', 'trainer', 'admin')
  async findAll(
    @Request() req: AuthRequest,
    @Query(new ZodValidationPipe(paginationSchema))
    query: PaginationDto,
  ) {
    const userId = req.user.id;
    const userRole = req.user.role;
    return this.nutritionPlanService.findAll(query, userId, userRole);
  }

  @Get('user/:userId')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam('userId')
  findByUserId(@Param('userId') userId: string) {
    return this.nutritionPlanService.findByUserId(userId);
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  async findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.nutritionPlanService.findById(id, requesterOf(req));
  }

  @Put(':id')
  @Roles('trainer', 'admin', 'user')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(nutritionPlanUpdateBodySchema))
    data: Partial<NutritionPlan>,
    @Request() req: AuthRequest,
  ) {
    return this.nutritionPlanService.update(id, data, requesterOf(req));
  }

  @Delete(':id')
  @Roles('trainer', 'admin', 'user')
  async delete(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.nutritionPlanService.remove(id, requesterOf(req));
  }

  @Get('user/:userId/with-shared')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam('userId')
  async findByUserWithShared(@Param('userId') userId: string) {
    return this.nutritionPlanService.findByUserIdWithShared(userId);
  }

  @Post(':id/share')
  @Roles('trainer', 'admin', 'user')
  async sharePlan(
    @Param('id') planId: string,
    @Body(new ZodValidationPipe(shareBodySchema))
    body: { userIds: string[] },
    @Request() req: AuthRequest,
  ) {
    return this.nutritionPlanService.sharePlan(
      planId,
      body.userIds,
      requesterOf(req),
    );
  }

  // The `:userId` here is whose access is being revoked, not the caller, so it
  // deliberately carries no @OwnsUserParam — authority to revoke comes from
  // being able to write the plan, which the service checks.
  @Delete(':id/share/:userId')
  @Roles('trainer', 'admin', 'user')
  async revokeShare(
    @Param('id') planId: string,
    @Param('userId') userId: string,
    @Request() req: AuthRequest,
  ) {
    return this.nutritionPlanService.revokeShare(
      planId,
      userId,
      requesterOf(req),
    );
  }

  @Post(':id/ratings')
  @Roles('user', 'trainer', 'admin')
  async addRating(
    @Param('id') planId: string,
    @Body(new ZodValidationPipe(ratingBodySchema))
    body: { rating: number; comment?: string },
    @Request() req: AuthRequest,
  ) {
    return await this.nutritionPlanService.addRating(
      planId,
      requesterOf(req),
      body.rating,
      body.comment,
    );
  }

  @Post(':id/activate')
  @Roles('user', 'trainer', 'admin')
  async activateNutritionPlan(
    @Param('id') planId: string,
    @Request() req: AuthRequest,
  ) {
    return await this.nutritionPlanService.activateNutritionPlan(
      planId,
      requesterOf(req),
    );
  }
}
