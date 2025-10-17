import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TrainingPlanService } from './training-plan.service';
import { TrainingPlan, trainingPlanSchema } from './training-plan.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import { paginationSchema } from '../../common/dto/pagination.dto';

@Controller('training-plans')
@UseGuards(RolesGuard) // Apply RolesGuard to all routes in this controller
export class TrainingPlanController {
  constructor(private readonly trainingPlanService: TrainingPlanService) {}
  @Post()
  @Roles('trainer', 'admin') // Only trainers and admins can create plans
  async create(
    @Body(new ZodValidationPipe(trainingPlanSchema.partial()))
    data: Partial<TrainingPlan>,
  ) {
    return this.trainingPlanService.create(data);
  }

  @Get()
  @Roles('user', 'trainer', 'admin') // All authenticated users can view plans
  async findAll(
    @Query(new ZodValidationPipe(paginationSchema))
    query: PaginationDto,
  ) {
    return this.trainingPlanService.findAll(query);
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  async findOne(@Param('id') id: string) {
    return this.trainingPlanService.findById(id);
  }

  @Put(':id')
  @Roles('trainer', 'admin')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(trainingPlanSchema.partial()))
    data: Partial<TrainingPlan>,
  ) {
    return this.trainingPlanService.update(id, data);
  }
}
