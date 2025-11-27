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
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NutritionPlanService } from './nutrition-plan.service';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import { paginationSchema } from '../../common/dto/pagination.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthRequest } from '../../common/interfaces/auth.interfaces';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  nutritionPlanSchema,
  type NutritionPlan,
} from './nutrition-plan.schema';

@Controller('nutrition-plans')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class NutritionPlanController {
  constructor(private readonly nutritionPlanService: NutritionPlanService) {}

  @Post()
  @Roles('trainer', 'admin', 'user')
  async create(
    @Body(new ZodValidationPipe(nutritionPlanSchema.partial()))
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
    @Body(new ZodValidationPipe(nutritionPlanSchema.partial()))
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
  async sharePlan(@Param('id') planId: string, @Body() body: { userIds: string[] }) {
    if (!body.userIds || !Array.isArray(body.userIds)) {
      throw new ForbiddenException('userIds array is required');
    }
    return this.nutritionPlanService.sharePlan(planId, body.userIds);
  }

  @Delete(':id/share/:userId')
  @Roles('trainer', 'admin', 'user')
  async revokeShare(@Param('id') planId: string, @Param('userId') userId: string) {
    return this.nutritionPlanService.revokeShare(planId, userId);
  }
}
