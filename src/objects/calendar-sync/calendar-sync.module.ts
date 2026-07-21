import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarSyncController } from './calendar-sync.controller';
import { CalendarSyncCronController } from './calendar-sync-cron.controller';
import { CalendarSyncScheduler } from './calendar-sync.scheduler';

/**
 * Serverless platforms freeze the process between requests, so the in-process
 * @Cron scheduler cannot fire. On Vercel the equivalent work is triggered over
 * HTTP by Vercel Cron instead; registering both would double-run the sync.
 */
const IS_SERVERLESS = !!process.env.VERCEL;
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
  controllers: [CalendarSyncController, CalendarSyncCronController],
  providers: [
    CalendarSyncService,
    ...(IS_SERVERLESS ? [] : [CalendarSyncScheduler]),
    JwtAuthGuard,
    {
      provide: 'TokenBlacklistService',
      useClass: TokenBlacklistService,
    },
  ],
  exports: [CalendarSyncService],
})
export class CalendarSyncModule {}
