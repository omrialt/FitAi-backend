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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AiRecommendationService } from './ai-recommendation.service';
import type {
  CreateAiRecommendationDto,
  UpdateAiRecommendationDto,
} from '../interfaces/ai-recommendation.interfaces';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import type { RecommendationCategory } from './ai-recommendation.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('ai-recommendations')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AiRecommendationController {
  constructor(
    private readonly aiRecommendationService: AiRecommendationService,
  ) {}

  @Post()
  @Roles('admin', 'trainer')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateAiRecommendationDto) {
    return this.aiRecommendationService.create(createDto);
  }

  @Get()
  @Roles('user', 'trainer', 'admin')
  findAll(@Query() query: PaginationDto) {
    return this.aiRecommendationService.findAll(query);
  }

  @Get('user/:userId')
  @Roles('user', 'trainer', 'admin')
  findByUserId(@Param('userId') userId: string) {
    return this.aiRecommendationService.findByUserId(userId);
  }

  @Get('category/:category')
  @Roles('user', 'trainer', 'admin')
  findByCategory(@Param('category') category: RecommendationCategory) {
    return this.aiRecommendationService.findByCategory(category);
  }

  @Get('user/:userId/category/:category')
  @Roles('user', 'trainer', 'admin')
  findByUserAndCategory(
    @Param('userId') userId: string,
    @Param('category') category: RecommendationCategory,
  ) {
    return this.aiRecommendationService.findByUserAndCategory(userId, category);
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  findOne(@Param('id') id: string) {
    return this.aiRecommendationService.findById(id);
  }

  @Patch(':id')
  @Roles('admin', 'trainer')
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdateAiRecommendationDto,
  ) {
    return this.aiRecommendationService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles('admin', 'trainer')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.aiRecommendationService.remove(id);
  }
}
