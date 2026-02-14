import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarSyncController } from './calendar-sync.controller';
import { CalendarSyncScheduler } from './calendar-sync.scheduler';
import { TrainingPlanSchema } from '../training-plan/training-plan.schema';
import { UserSchema } from '../user/user.schema';
import { GoogleCalendarModule } from '../../common/google-calendar/google-calendar.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TokenBlacklistService } from '../auth/token-blacklist.service';
import { TokenBlacklistSchema } from '../auth/token-blacklist.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'TrainingPlan', schema: TrainingPlanSchema },
      { name: 'User', schema: UserSchema },
      { name: 'TokenBlacklist', schema: TokenBlacklistSchema },
    ]),
    GoogleCalendarModule,
    AuthModule,
  ],
  controllers: [CalendarSyncController],
  providers: [
    CalendarSyncService,
    CalendarSyncScheduler,
    JwtAuthGuard,
    {
      provide: 'TokenBlacklistService',
      useClass: TokenBlacklistService,
    },
  ],
  exports: [CalendarSyncService],
})
export class CalendarSyncModule {}
