import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  NutritionPlanService,
  CreateNutritionPlanDto,
  UpdateNutritionPlanDto,
} from './nutrition-plan.service';
import type { PaginationDto } from '../../common/dto/pagination.dto';

@Controller('nutrition-plans')
export class NutritionPlanController {
  constructor(private readonly nutritionPlanService: NutritionPlanService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateNutritionPlanDto) {
    return this.nutritionPlanService.create(createDto);
  }

  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.nutritionPlanService.findAll(query);
  }

  @Get('user/:userId')
  findByUserId(@Param('userId') userId: string) {
    return this.nutritionPlanService.findByUserId(userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.nutritionPlanService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateNutritionPlanDto) {
    return this.nutritionPlanService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.nutritionPlanService.remove(id);
  }
}
