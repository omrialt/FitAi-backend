import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { ExerciseService } from './exercise.service';
// Value imports: a type-only import erases the class and the global
// ValidationPipe then never sees a DTO to validate.
import {
  ExerciseAlternativesDto,
  SearchExercisesDto,
  SubstituteExercisesDto,
} from '../../interfaces/exercise.interfaces';
import { MUSCLE_GROUPS, EQUIPMENT } from './exercise.schema';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * The catalogue is shared reference content, not user data, so there is no
 * ownership guard here — only authentication. Every signed-in user sees the
 * same rows, and there is nothing in them that belongs to anyone.
 */
@Controller('exercises')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ExerciseController {
  constructor(private readonly exerciseService: ExerciseService) {}

  @Get()
  @Roles('user', 'trainer', 'admin')
  search(@Query() query: SearchExercisesDto) {
    return this.exerciseService.search(query);
  }

  /**
   * The vocabulary itself, so the client's filters and labels come from the
   * same list the server validates against instead of a hand-copied duplicate
   * that drifts.
   *
   * Declared before `:slug` — Express matches in registration order, and
   * otherwise this binds `slug: 'meta'`.
   */
  @Get('meta')
  @Roles('user', 'trainer', 'admin')
  meta() {
    return { muscleGroups: MUSCLE_GROUPS, equipment: EQUIPMENT };
  }

  /**
   * Substitutes for a plan's free-text exercise name.
   *
   * Declared before `:slug` — Express matches in registration order, so
   * otherwise this binds `slug: 'substitutes'` and 404s.
   *
   * A name the catalogue does not recognise returns `matched: null` with an
   * empty list and a 200, not a 404: to the caller that means "no button for
   * this exercise", which is an ordinary outcome and not a failure.
   */
  @Get('substitutes')
  @Roles('user', 'trainer', 'admin')
  substitutes(@Query() query: SubstituteExercisesDto) {
    return this.exerciseService.alternativesForName(query.name, {
      equipment: query.equipment,
      limit: query.limit,
    });
  }

  @Get(':slug')
  @Roles('user', 'trainer', 'admin')
  async findOne(@Param('slug') slug: string) {
    const exercise = await this.exerciseService.findBySlug(slug);
    if (!exercise) {
      throw new NotFoundException(`No exercise with slug "${slug}"`);
    }
    return exercise;
  }

  /** Other exercises for the same primary muscle. */
  @Get(':slug/alternatives')
  @Roles('user', 'trainer', 'admin')
  alternatives(
    @Param('slug') slug: string,
    @Query() query: ExerciseAlternativesDto,
  ) {
    return this.exerciseService.alternatives(slug, query.limit);
  }
}
