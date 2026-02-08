import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  Req,
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

@Controller('calendar-sync')
@UseGuards(JwtAuthGuard)
export class CalendarSyncController {
  constructor(
    private readonly calendarSyncService: CalendarSyncService,
    private readonly googleCalendarService: GoogleCalendarService,
    @InjectModel('User')
    private userModel: Model<UserDocument>,
  ) {}

  /**
   * Get Google Calendar OAuth URL
   */
  @Get('google/auth-url')
  getGoogleAuthUrl() {
    const authUrl = this.googleCalendarService.getAuthUrl();
    return { authUrl };
  }

  /**
   * Handle Google OAuth callback
   */
  @Post('google/callback')
  @HttpCode(HttpStatus.OK)
  async handleGoogleCallback(
    @Req() req: express.Request,
    @Body('code') code: string,
  ) {
    const userId = req.user?.['userId'] as string;

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

    return {
      message: 'Google Calendar connected successfully',
      connected: true,
    };
  }

  /**
   * Get connection status
   */
  @Get('google/status')
  async getConnectionStatus(@Req() req: express.Request) {
    const userId = req.user?.['userId'] as string;
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
  @HttpCode(HttpStatus.OK)
  async disconnectGoogle(@Req() req: express.Request) {
    const userId = req.user?.['userId'] as string;
    await this.calendarSyncService.disconnectGoogleCalendar(userId);

    return { message: 'Google Calendar disconnected successfully' };
  }

  /**
   * Get weekly calendar view (merged training + Google events)
   */
  @Get('weekly')
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
  @HttpCode(HttpStatus.OK)
  async syncTrainingPlan(
    @Req() req: express.Request,
    @Body('trainingPlanId') trainingPlanId: string,
    @Body('weekStart') weekStart?: string,
  ) {
    const userId = req.user?.['userId'] as string;
    const startDate = weekStart ? new Date(weekStart) : undefined;

    const result = await this.calendarSyncService.syncTrainingPlanToGoogle(
      userId,
      trainingPlanId,
      startDate,
    );

    return {
      message: 'Training plan synced successfully',
      ...result,
    };
  }
}
