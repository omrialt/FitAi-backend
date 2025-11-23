import { Measurements } from '../physical-data/physical-data.schema';

export class CreatePhysicalDataDto {
  userId!: string;
  heightCm!: number;
  weightKg!: number;
  bodyFatPercent?: number;
  measurements?: Measurements;
  dateRecorded?: Date;
}

export class UpdatePhysicalDataDto {
  heightCm?: number;
  weightKg?: number;
  bodyFatPercent?: number;
  measurements?: Measurements;
  dateRecorded?: Date;
}
