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
import { PhysicalTargetService } from './physical-target.service';
// Value imports on purpose: `import type` erases the class, the emitted
// parameter metadata becomes `Function`, and the ValidationPipe then passes
// `undefined` to the handler instead of the body.
import {
  CreatePhysicalTargetDto,
  UpdatePhysicalTargetDto,
} from '../../interfaces/physical-target.interfaces';
import type { AuthRequest } from '../../interfaces/jwt.interfaces';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserOwnershipGuard } from '../../common/guards/ownership.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnsUserParam } from '../../common/decorators/owns-user-param.decorator';

@Controller('physical-targets')
@UseGuards(AuthGuard('jwt'), RolesGuard, UserOwnershipGuard)
export class PhysicalTargetController {
  constructor(private readonly physicalTargetService: PhysicalTargetService) {}

  @Post()
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createDto: CreatePhysicalTargetDto,
    @Request() req: AuthRequest,
  ) {
    // Body-supplied userId is honoured only for admins; everyone else sets
    // targets against themselves no matter what they send.
    const userId =
      req.user.role === 'admin' && createDto.userId
        ? createDto.userId
        : req.user.id;
    return this.physicalTargetService.create({ ...createDto, userId });
  }

  @Get('user/:userId')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  findByUserId(
    @Param('userId') userId: string,
    @Query('status') status?: string,
  ) {
    return this.physicalTargetService.findByUserId(userId, status);
  }

  @Get('user/:userId/progress')
  @Roles('user', 'trainer', 'admin')
  @OwnsUserParam()
  getProgress(@Param('userId') userId: string) {
    return this.physicalTargetService.getProgress(userId);
  }

  @Get(':id')
  @Roles('user', 'trainer', 'admin')
  findOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.physicalTargetService.findById(id, req.user);
  }

  @Patch(':id')
  @Roles('user', 'trainer', 'admin')
  update(
    @Param('id') id: string,
    @Body() data: UpdatePhysicalTargetDto,
    @Request() req: AuthRequest,
  ) {
    // Only forward target fields; userId is never reassigned here.
    const updateData = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.targetDate !== undefined && {
        targetDate: new Date(data.targetDate),
      }),
      ...(data.targetValues !== undefined && {
        targetValues: data.targetValues,
      }),
      ...(data.notes !== undefined && { notes: data.notes }),
      ...(data.status !== undefined && { status: data.status }),
    };
    return this.physicalTargetService.update(id, updateData, req.user);
  }

  @Delete(':id')
  @Roles('user', 'trainer', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.physicalTargetService.remove(id, req.user);
  }
}
