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
} from '@nestjs/common';
import { ExercisePerformanceService } from './exercise-performance.service';
import type {
  CreateExercisePerformanceDto,
  UpdateExercisePerformanceDto,
} from '../interfaces/exercise-performance.interfaces';
import type { ExercisePerformance } from './exercise-performance.schema';

@Controller('performance')
export class ExercisePerformanceController {
  constructor(
    private readonly exercisePerformanceService: ExercisePerformanceService,
  ) {}

  @Post()
  async create(
    @Body(ValidationPipe) createData: CreateExercisePerformanceDto,
  ): Promise<ExercisePerformance> {
    return this.exercisePerformanceService.create(createData);
  }

  @Get()
  async findAll(): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.findAll();
  }

  @Get('user/:userId')
  async findByUserId(
    @Param('userId') userId: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.findByUserId(userId);
  }

  @Get('exercise/:exerciseId')
  async findByExerciseId(
    @Param('exerciseId') exerciseId: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.findByExerciseId(exerciseId);
  }

  @Get('user/:userId/exercise/:exerciseId')
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
  async findByTrainingPlan(
    @Param('trainingPlanId') trainingPlanId: string,
  ): Promise<ExercisePerformance[]> {
    return this.exercisePerformanceService.findByTrainingPlan(trainingPlanId);
  }

  @Get('user/:userId/exercise/:exerciseId/latest')
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
  async findById(@Param('id') id: string): Promise<ExercisePerformance> {
    return this.exercisePerformanceService.findById(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateData: UpdateExercisePerformanceDto,
  ): Promise<ExercisePerformance> {
    return this.exercisePerformanceService.update(id, updateData);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<void> {
    return this.exercisePerformanceService.delete(id);
  }
}