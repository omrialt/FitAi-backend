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
import {
  PhysicalDataService,
} from './physical-data.service';
import type {
  CreatePhysicalDataDto,
  UpdatePhysicalDataDto,
} from '../interfaces/physical-data.interfaces';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('physical-data')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PhysicalDataController {
  constructor(private readonly physicalDataService: PhysicalDataService) {}

  @Post()
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreatePhysicalDataDto) {
    return this.physicalDataService.create(createDto);
  }

  @Get()
  @Roles('admin', 'trainer')
  findAll(@Query() query: PaginationDto) {
    return this.physicalDataService.findAll(query);
  }

  @Get('user/:userId')
  @Roles('user', 'trainer', 'admin')
  findByUserId(@Param('userId') userId: string) {
    return this.physicalDataService.findByUserId(userId);
  }

  @Get('user/:userId/latest')
  @Roles('user', 'trainer', 'admin')
  findLatestByUserId(@Param('userId') userId: string) {
    return this.physicalDataService.findLatestByUserId(userId);
  }

  @Get('user/:userId/progress')
  @Roles('user', 'trainer', 'admin')
  getWeightProgress(@Param('userId') userId: string) {
    return this.physicalDataService.getWeightProgress(userId);
  }

  @Get('user/:userId/bmi')
  @Roles('user', 'trainer', 'admin')
  async calculateBMI(
    @Param('userId') userId: string,
  ): Promise<{ bmi: number; category: string }> {
    const latest = await this.physicalDataService.findLatestByUserId(userId);
    if (!latest) {
      return { bmi: 0, category: 'No data' };
    }

    if (!latest.heightCm) {
      return { bmi: 0, category: 'Height not available' };
    }

    const bmi = this.physicalDataService.calculateBMI(
      latest.heightCm,
      latest.weightKg,
    );

    let category = '';
    if (bmi < 18.5) category = 'Underweight';
    else if (bmi < 25) category = 'Normal weight';
    else if (bmi < 30) category = 'Overweight';
    else category = 'Obese';

    return { bmi, category };
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  findOne(@Param('id') id: string) {
    return this.physicalDataService.findById(id);
  }

  @Patch(':id')
  @Roles('user', 'trainer', 'admin')
  update(@Param('id') id: string, @Body() updateDto: UpdatePhysicalDataDto) {
    return this.physicalDataService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.physicalDataService.remove(id);
  }
}
