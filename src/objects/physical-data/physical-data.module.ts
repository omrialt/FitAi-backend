import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PhysicalDataSchema } from './physical-data.schema';
import { PhysicalDataService } from './physical-data.service';
import { PhysicalDataController } from './physical-data.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'PhysicalData', schema: PhysicalDataSchema },
    ]),
  ],
  controllers: [PhysicalDataController],
  providers: [PhysicalDataService],
  exports: [PhysicalDataService],
})
export class PhysicalDataModule {}
