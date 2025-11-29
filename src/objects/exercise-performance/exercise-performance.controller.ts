import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  ValidationPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ExercisePerformanceService } from './exercise-performance.service';
import type {
  CreateExercisePerformanceDto,
  UpdateExercisePerformanceDto,
} from '../interfaces/exercise-performance.interfaces';
import type { ExercisePerformance } from './exercise-performance.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('performance')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ExercisePerformanceController {
  constructor(
    private readonly exercisePerformanceService: ExercisePerformanceService,
  ) {}

  @Post()
  @Roles('user', 'trainer', 'admin')
  async create(
    @Body(ValidationPipe) createData: CreateExercisePerformanceDto,
  ): Promise<ExercisePerformance> {
    return this.exercisePerformanceService.create(createData);
  }

  @Get()
  @Roles('admin', 'trainer')
  async findAll(): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.findAll();
  }

  @Get('user/:userId')
  @Roles('user', 'trainer', 'admin')
  async findByUserId(
    @Param('userId') userId: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.findByUserId(userId);
  }

  @Get('exercise/:exerciseId')
  @Roles('user', 'trainer', 'admin')
  async findByExerciseId(
    @Param('exerciseId') exerciseId: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.findByExerciseId(exerciseId);
  }

  @Get('user/:userId/exercise/:exerciseId')
  @Roles('user', 'trainer', 'admin')
  async findByUserAndExercise(
    @Param('userId') userId: string,
    @Param('exerciseId') exerciseId: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.findByUserAndExercise(
      userId,
      exerciseId,
    );
  }

  @Get('training-plan/:trainingPlanId')
  @Roles('user', 'trainer', 'admin')
  async findByTrainingPlan(
    @Param('trainingPlanId') trainingPlanId: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.findByTrainingPlan(trainingPlanId);
  }

  @Get('user/:userId/exercise/:exerciseId/latest')
  @Roles('user', 'trainer', 'admin')
  async getLatestPerformance(
    @Param('userId') userId: string,
    @Param('exerciseId') exerciseId: string,
  ): Promise<ExercisePerformance | null> {
    return this.exercisePerformanceService.getLatestPerformanceForExercise(
      userId,
      exerciseId,
    );
  }

  @Get('user/:userId/exercise/:exerciseId/history')
  @Roles('user', 'trainer', 'admin')
  async getPerformanceHistory(
    @Param('userId') userId: string,
    @Param('exerciseId') exerciseId: string,
    @Query('limit') limit?: string,
  ): Promise<ExercisePerformance[]> {
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    return this.exercisePerformanceService.getPerformanceHistory(
      userId,
      exerciseId,
      limitNumber,
    );
  }

  @Get('user/:userId/date-range')
  @Roles('user', 'trainer', 'admin')
  async getPerformanceByDateRange(
    @Param('userId') userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.getPerformanceByDateRange(
      userId,
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  async findById(@Param('id') id: string): Promise<ExercisePerformance> {
    return this.exercisePerformanceService.findById(id);
  }

  @Put(':id')
  @Roles('user', 'trainer', 'admin')
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateData: UpdateExercisePerformanceDto,
  ): Promise<ExercisePerformance> {
    return this.exercisePerformanceService.update(id, updateData);
  }

  @Delete(':id')
  @Roles('user', 'trainer', 'admin')
  async delete(@Param('id') id: string): Promise<void> {
    return this.exercisePerformanceService.delete(id);
  }
}
