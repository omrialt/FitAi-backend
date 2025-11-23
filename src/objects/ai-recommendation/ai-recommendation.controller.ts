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
import { AiRecommendationService } from './ai-recommendation.service';
import type {
  CreateAiRecommendationDto,
  UpdateAiRecommendationDto,
} from '../interfaces/ai-recommendation.interfaces';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import type { RecommendationCategory } from './ai-recommendation.schema';

@Controller('ai-recommendations')
export class AiRecommendationController {
  constructor(
    private readonly aiRecommendationService: AiRecommendationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateAiRecommendationDto) {
    return this.aiRecommendationService.create(createDto);
  }

  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.aiRecommendationService.findAll(query);
  }

  @Get('user/:userId')
  findByUserId(@Param('userId') userId: string) {
    return this.aiRecommendationService.findByUserId(userId);
  }

  @Get('category/:category')
  findByCategory(@Param('category') category: RecommendationCategory) {
    return this.aiRecommendationService.findByCategory(category);
  }

  @Get('user/:userId/category/:category')
  findByUserAndCategory(
    @Param('userId') userId: string,
    @Param('category') category: RecommendationCategory,
  ) {
    return this.aiRecommendationService.findByUserAndCategory(userId, category);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.aiRecommendationService.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdateAiRecommendationDto,
  ) {
    return this.aiRecommendationService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.aiRecommendationService.remove(id);
  }
}
