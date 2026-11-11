import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { FoodService } from './food.service';
// Value imports: a type-only import erases the class and the global
// ValidationPipe then never sees a DTO to validate.
import { ParseFoodDto, SearchFoodDto } from '../../interfaces/food.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { isAiAllowed } from '../../common/anthropic/ai-access';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';

/**
 * Nutrition facts are public reference content, like the exercise catalogue,
 * so there is authentication here but no ownership guard — every signed-in
 * user sees the same rows and none of them belong to anyone.
 *
 * `/parse` is different in one respect: it spends a model call and a database
 * request per use, so it is the second thing in the app that costs money. It
 * still takes only the caller's own text and writes nothing to their account —
 * the client decides what to do with the result.
 */
@Controller('foods')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class FoodController {
  constructor(private readonly foods: FoodService) {}

  /**
   * Lets the client show a manual-entry field instead of a search box that
   * silently returns nothing. Declared before any parameterised route.
   */
  @Get('status')
  @Roles('user', 'trainer', 'admin')
  status(@Request() req: AuthRequest) {
    return {
      // Search is a database lookup with no model behind it: open to all.
      search: this.foods.searchAvailable,
      parse: isAiAllowed(req.user.email) && this.foods.parseAvailable,
    };
  }

  @Get('search')
  @Roles('user', 'trainer', 'admin')
  search(@Query() query: SearchFoodDto) {
    return this.foods.search(query.q, query.limit);
  }

  /**
   * Free text to a list of foods with real macros.
   *
   * Always 200, and `available: false` rather than a 503 when the feature is
   * not configured: the client's fallback is the manual meal editor it already
   * has, and an error would send it down a path meant for actual failures.
   */
  @Post('parse')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.OK)
  parse(@Body() body: ParseFoodDto, @Request() req: AuthRequest) {
    // Same shape as "not configured", for the same reason: the fallback is
    // the manual editor, and this must not spend a model call.
    if (!isAiAllowed(req.user.email)) return { items: [], available: false };
    return this.foods.parse(body.text);
  }
}
