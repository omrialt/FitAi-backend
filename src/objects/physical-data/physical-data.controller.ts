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
  PhysicalDataService,
} from './physical-data.service';
import type {
  CreatePhysicalDataDto,
  UpdatePhysicalDataDto,
} from '../interfaces/physical-data.interfaces';
import type { PaginationDto } from '../../common/dto/pagination.dto';

@Controller('physical-data')
export class PhysicalDataController {
  constructor(private readonly physicalDataService: PhysicalDataService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreatePhysicalDataDto) {
    return this.physicalDataService.create(createDto);
  }

  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.physicalDataService.findAll(query);
  }

  @Get('user/:userId')
  findByUserId(@Param('userId') userId: string) {
    return this.physicalDataService.findByUserId(userId);
  }

  @Get('user/:userId/latest')
  findLatestByUserId(@Param('userId') userId: string) {
    return this.physicalDataService.findLatestByUserId(userId);
  }

  @Get('user/:userId/progress')
  getWeightProgress(@Param('userId') userId: string) {
    return this.physicalDataService.getWeightProgress(userId);
  }

  @Get('user/:userId/bmi')
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
  findOne(@Param('id') id: string) {
    return this.physicalDataService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdatePhysicalDataDto) {
    return this.physicalDataService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.physicalDataService.remove(id);
  }
}
