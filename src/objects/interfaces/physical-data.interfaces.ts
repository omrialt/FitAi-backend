import { Measurements } from '../physical-data/physical-data.schema';
import { PartialType } from '@nestjs/mapped-types';

export class CreatePhysicalDataDto {
  userId!: string;
  heightCm!: number;
  weightKg!: number;
  bodyFatPercent?: number;
  measurements?: Measurements;
  dateRecorded?: Date;
}

export class UpdatePhysicalDataDto extends PartialType(CreatePhysicalDataDto) {
  userId?: string;
}
