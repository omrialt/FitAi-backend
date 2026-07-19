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
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
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

@Controller('nutrition-plans')
@UseGuards(AuthGuard('jwt'), RolesGuard)
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
  findByUserId(@Param('userId') userId: string) {
    return this.nutritionPlanService.findByUserId(userId);
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  async findOne(@Param('id') id: string) {
    return this.nutritionPlanService.findById(id);
  }

  @Put(':id')
  @Roles('trainer', 'admin', 'user')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(nutritionPlanUpdateBodySchema))
    data: Partial<NutritionPlan>,
  ) {
    return this.nutritionPlanService.update(id, data);
  }

  @Delete(':id')
  @Roles('trainer', 'admin', 'user')
  async delete(@Param('id') id: string) {
    return this.nutritionPlanService.remove(id);
  }

  @Get('user/:userId/with-shared')
  @Roles('user', 'trainer', 'admin')
  async findByUserWithShared(@Param('userId') userId: string) {
    return this.nutritionPlanService.findByUserIdWithShared(userId);
  }

  @Post(':id/share')
  @Roles('trainer', 'admin', 'user')
  async sharePlan(
    @Param('id') planId: string,
    @Body(new ZodValidationPipe(shareBodySchema))
    body: { userIds: string[] },
  ) {
    return this.nutritionPlanService.sharePlan(planId, body.userIds);
  }

  @Delete(':id/share/:userId')
  @Roles('trainer', 'admin', 'user')
  async revokeShare(
    @Param('id') planId: string,
    @Param('userId') userId: string,
  ) {
    return this.nutritionPlanService.revokeShare(planId, userId);
  }

  @Post(':id/ratings')
  @Roles('user', 'trainer', 'admin')
  async addRating(
    @Param('id') planId: string,
    @Body(new ZodValidationPipe(ratingBodySchema))
    body: { rating: number; comment?: string },
    @Request() req: AuthRequest,
  ) {
    const userId = req.user.id;
    return await this.nutritionPlanService.addRating(
      planId,
      userId,
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
    const userId = req.user.id;
    return await this.nutritionPlanService.activateNutritionPlan(
      planId,
      userId,
    );
  }
}
