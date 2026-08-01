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
import { PhysicalDataService } from './physical-data.service';
// Value imports on purpose: `import type` erases the class, the emitted
// parameter metadata becomes `Function`, and the ValidationPipe then passes
// `undefined` to the handler instead of the body.
import {
  CreatePhysicalDataDto,
  UpdatePhysicalDataDto,
} from '../../interfaces/physical-data.interfaces';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserOwnershipGuard } from '../../common/guards/ownership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnsUserParam } from '../../common/decorators/owns-user-param.decorator';

@Controller('physical-data')
@UseGuards(AuthGuard('jwt'), RolesGuard, UserOwnershipGuard)
export class PhysicalDataController {
  constructor(private readonly physicalDataService: PhysicalDataService) {}

  @Post()
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createDto: CreatePhysicalDataDto,
    @Request() req: AuthRequest,
  ) {
    // Body-supplied userId is honoured only for admins; everyone else files
    // measurements against themselves no matter what they send.
    const userId =
      req.user.role === 'admin' && createDto.userId
        ? createDto.userId
        : req.user.id;
    return this.physicalDataService.create({ ...createDto, userId });
  }

  @Get()
  @Roles('admin', 'trainer')
  findAll(@Query() query: PaginationDto) {
    return this.physicalDataService.findAll(query);
  }

  @Get('user/:userId')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  findByUserId(@Param('userId') userId: string) {
    return this.physicalDataService.findByUserId(userId);
  }

  @Get('user/:userId/latest')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  findLatestByUserId(@Param('userId') userId: string) {
    return this.physicalDataService.findLatestByUserId(userId);
  }

  @Get('user/:userId/progress')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  getWeightProgress(@Param('userId') userId: string) {
    return this.physicalDataService.getWeightProgress(userId);
  }

  @Get('user/:userId/bmi')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
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
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.physicalDataService.findById(id, req.user);
  }

  @Patch(':id')
  @Roles('user', 'trainer', 'admin')
  update(
    @Param('id') id: string,
    @Body() data: UpdatePhysicalDataDto,
    @Request() req: AuthRequest,
  ) {
    // Only forward the measurement fields; userId is never reassigned here.
    const updateData = {
      ...(data.heightCm !== undefined && { heightCm: data.heightCm }),
      ...(data.weightKg !== undefined && { weightKg: data.weightKg }),
      ...(data.bodyFatPercent !== undefined && {
        bodyFatPercent: data.bodyFatPercent,
      }),
      ...(data.measurements !== undefined && {
        measurements: data.measurements,
      }),
      ...(data.dateRecorded !== undefined && {
        dateRecorded: new Date(data.dateRecorded),
      }),
    };
    return this.physicalDataService.update(id, updateData, req.user);
  }

  @Delete(':id')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.physicalDataService.remove(id, req.user);
  }
}
