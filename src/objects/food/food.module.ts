import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FoodItemSchema } from './food.schema';
import { FoodService } from './food.service';
import { FoodController } from './food.controller';
import { UsdaClient } from './usda.client';

/**
 * The `FoodItem` collection is a cache of USDA's answers, not user data — no
 * `userId`, shared by every account, and safe to drop entirely at the cost of
 * a slower first search.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'FoodItem', schema: FoodItemSchema }]),
  ],
  controllers: [FoodController],
  providers: [FoodService, UsdaClient],
  exports: [FoodService],
})
export class FoodModule {}
