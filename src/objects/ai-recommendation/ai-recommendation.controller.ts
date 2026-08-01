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
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AiRecommendationService } from './ai-recommendation.service';
// Value imports so the global ValidationPipe actually validates these.
import {
  CreateAiRecommendationDto,
  UpdateAiRecommendationDto,
} from '../../interfaces/ai-recommendation.interfaces';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import type { RecommendationCategory } from './ai-recommendation.schema';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserOwnershipGuard } from '../../common/guards/ownership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnsUserParam } from '../../common/decorators/owns-user-param.decorator';

@Controller('ai-recommendations')
@UseGuards(AuthGuard('jwt'), RolesGuard, UserOwnershipGuard)
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

  // Narrowed from 'user' to admin: this returns every user's recommendations,
  // so it is an administrative listing, not something a client should call.
  @Get()
  @Roles('admin')
  findAll(@Query() query: PaginationDto) {
    return this.aiRecommendationService.findAll(query);
  }

  @Get('user/:userId')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  findByUserId(@Param('userId') userId: string) {
    return this.aiRecommendationService.findByUserId(userId);
  }

  // Also cross-user by nature — same reasoning as findAll above.
  @Get('category/:category')
  @Roles('admin')
  findByCategory(@Param('category') category: RecommendationCategory) {
    return this.aiRecommendationService.findByCategory(category);
  }

  @Get('user/:userId/category/:category')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  findByUserAndCategory(
    @Param('userId') userId: string,
    @Param('category') category: RecommendationCategory,
  ) {
    return this.aiRecommendationService.findByUserAndCategory(userId, category);
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.aiRecommendationService.findById(id, req.user);
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
