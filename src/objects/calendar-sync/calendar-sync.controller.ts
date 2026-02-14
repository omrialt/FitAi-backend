import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CalendarSyncService } from './calendar-sync.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import * as express from 'express';
import { GoogleCalendarService } from '../../common/google-calendar/google-calendar.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDocument } from '../user/user.schema';
import { ConfigService } from '@nestjs/config';

@Controller('calendar-sync')
export class CalendarSyncController {
  constructor(
    private readonly calendarSyncService: CalendarSyncService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly configService: ConfigService,
    @InjectModel('User')
    private userModel: Model<UserDocument>,
  ) {}

  /**
   * Get Google Calendar OAuth URL - requires auth to get userId
   */
  @Get('google/auth-url')
  @UseGuards(JwtAuthGuard)
  getGoogleAuthUrl(@Req() req: express.Request) {
    const userId = req.user?.['id'] as string;
    const authUrl = this.googleCalendarService.getAuthUrl(userId);
    return { authUrl };
  }

  /**
   * Handle Google OAuth callback - called by Google, no JWT auth
   * Google redirects here with ?code=...&state=userId
   */
  @Get('google/callback')
  async handleGoogleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: express.Response,
  ) {
    const frontendUrl =
      this.configService.get<string>('frontendUrl') || 'http://localhost:5173';

    if (error) {
      return res.redirect(
        `${frontendUrl}/schedule?calendar_error=${encodeURIComponent(error)}`,
      );
    }

    try {
      const userId = state;

      // Exchange code for tokens
      const tokens = await this.googleCalendarService.getTokensFromCode(code);

      // Save tokens to user document
      await this.userModel
        .findByIdAndUpdate(userId, {
          googleCalendar: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiryDate: tokens.expiryDate,
            connected: true,
          },
        })
        .exec();

      return res.redirect(`${frontendUrl}/schedule?calendar_connected=true`);
    } catch (err) {
      console.error('Google Calendar callback error:', err);
      return res.redirect(
        `${frontendUrl}/schedule?calendar_error=connection_failed`,
      );
    }
  }

  /**
   * Get connection status
   */
  @Get('google/status')
  @UseGuards(JwtAuthGuard)
  async getConnectionStatus(@Req() req: express.Request) {
    const userId = req.user?.['id'] as string;
    const user = await this.userModel.findById(userId).exec();

    return {
      connected: !!user?.googleCalendar?.connected,
      hasRefreshToken: !!user?.googleCalendar?.refreshToken,
    };
  }

  /**
   * Disconnect Google Calendar
   */
  @Post('google/disconnect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disconnectGoogle(@Req() req: express.Request) {
    const userId = req.user?.['id'] as string;
    await this.calendarSyncService.disconnectGoogleCalendar(userId);

    return { message: 'Google Calendar disconnected successfully' };
  }

  /**
   * Get weekly calendar view (merged training + Google events)
   */
  @Get('weekly')
  @UseGuards(JwtAuthGuard)
  async getWeeklyCalendar(
    @Req() req: express.Request,
    @Query('weekStart') weekStart?: string,
  ) {
    const userId = req.user?.['id'] as string;
    const startDate = weekStart ? new Date(weekStart) : undefined;

    const events = await this.calendarSyncService.getWeeklyCalendar(
      userId,
      startDate,
    );

    return { events };
  }

  /**
   * Sync training plan to Google Calendar
   */
  @Post('sync-training-plan')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncTrainingPlan(
    @Req() req: express.Request,
    @Body('trainingPlanId') trainingPlanId: string,
    @Body('referenceDate') referenceDate?: string,
  ) {
    const userId = req.user?.['id'] as string;
    const refDate = referenceDate ? new Date(referenceDate) : undefined;

    const result = await this.calendarSyncService.syncTrainingPlanToGoogle(
      userId,
      trainingPlanId,
      refDate,
    );

    return {
      message: 'Training plan synced successfully',
      ...result,
    };
  }
}
