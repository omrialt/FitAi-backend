import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PhysicalTargetSchema } from './physical-target.schema';
import { PhysicalTargetService } from './physical-target.service';
import { PhysicalTargetController } from './physical-target.controller';
import { PhysicalDataModule } from '../physical-data/physical-data.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'PhysicalTarget', schema: PhysicalTargetSchema },
    ]),
    PhysicalDataModule,
  ],
  controllers: [PhysicalTargetController],
  providers: [PhysicalTargetService],
  exports: [PhysicalTargetService],
})
export class PhysicalTargetModule {}
