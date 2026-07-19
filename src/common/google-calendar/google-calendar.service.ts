import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { google } from 'googleapis';
import { OAuth2Client, OAuth2ClientOptions } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import { CalendarEvent } from '../../interfaces/calendar.interfaces';

@Injectable()
export class GoogleCalendarService {
  private oauth2Client: OAuth2Client;

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>('google.clientId');
    const clientSecret = this.configService.get<string>('google.clientSecret');
    const redirectUri = this.configService.get<string>('google.redirectUri');

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Missing required Google OAuth configuration');
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.oauth2Client = this.createOAuthClient({
      clientId,
      clientSecret,
      redirectUri,
    });
  }

  private createOAuthClient(options: OAuth2ClientOptions): OAuth2Client {
    return new (OAuth2Client as unknown as {
      new (options: OAuth2ClientOptions): OAuth2Client;
    })(options);
  }

  /**
   * Generate OAuth URL for user authorization
   */
  getAuthUrl(state?: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state,
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokensFromCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiryDate?: number;
  }> {
    try {
      // Disable רק על הקריאה ל-getToken
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
      const response = await this.oauth2Client.getToken(code);

      // עכשיו אנחנו יודעים שהטיפוסים בטוחים לפי interface שלנו
      const tokens = response.tokens;

      return {
        accessToken: tokens.access_token ?? '',
        refreshToken: tokens.refresh_token ?? undefined,
        expiryDate: tokens.expiry_date ?? undefined,
      };
    } catch (error) {
      console.error('Failed to exchange authorization code:', error);
      throw new BadRequestException('Failed to exchange authorization code');
    }
  }

  /**
   * Set credentials for the OAuth client
   */
  setCredentials(tokens: {
    access_token: string;
    refresh_token?: string;
    expiry_date?: number;
  }) {
    this.oauth2Client.setCredentials(tokens);
  }

  /**
   * Create OAuth client with user tokens
   */
  private createAuthClient(
    accessToken: string,
    refreshToken?: string,
    expiryDate?: number,
  ): OAuth2Client {
    const client = new OAuth2Client(
      this.configService.get<string>('google.clientId'),
      this.configService.get<string>('google.clientSecret'),
      this.configService.get<string>('google.redirectUri'),
    );

    client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      ...(expiryDate ? { expiry_date: expiryDate } : {}),
    });

    return client;
  }

  /**
   * List events from user's calendar
   */
  async listEvents(
    accessToken: string,
    refreshToken: string,
    timeMin: string,
    timeMax: string,
    expiryDate?: number,
  ): Promise<any[]> {
    const auth = this.createAuthClient(accessToken, refreshToken, expiryDate);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      return response.data.items || [];
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      throw new BadRequestException('Failed to fetch calendar events');
    }
  }

  /**
   * Create a calendar event
   */
  async createEvent(
    accessToken: string,
    refreshToken: string,
    event: CalendarEvent,
    expiryDate?: number,
  ): Promise<any> {
    const auth = this.createAuthClient(accessToken, refreshToken, expiryDate);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });

      return response.data;
    } catch (error) {
      console.error('Error creating calendar event:', error);
      throw new BadRequestException('Failed to create calendar event');
    }
  }

  /**
   * Update an existing calendar event
   */
  async updateEvent(
    accessToken: string,
    refreshToken: string,
    eventId: string,
    event: Partial<CalendarEvent>,
    expiryDate?: number,
  ): Promise<any> {
    const auth = this.createAuthClient(accessToken, refreshToken, expiryDate);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
      const response = await calendar.events.update({
        calendarId: 'primary',
        eventId,
        requestBody: event,
      });

      return response.data;
    } catch (error) {
      console.error('Error updating calendar event:', error);
      throw new BadRequestException('Failed to update calendar event');
    }
  }

  /**
   * Delete a calendar event
   */
  async deleteEvent(
    accessToken: string,
    refreshToken: string,
    eventId: string,
    expiryDate?: number,
  ): Promise<void> {
    const auth = this.createAuthClient(accessToken, refreshToken, expiryDate);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId,
      });
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      throw new BadRequestException('Failed to delete calendar event');
    }
  }

  /**
   * Find FitAi synced events by training plan ID
   */
  async findSyncedEvents(
    accessToken: string,
    refreshToken: string,
    trainingPlanId: string,
    timeMin: string,
    timeMax: string,
    expiryDate?: number,
  ): Promise<any[]> {
    const auth = this.createAuthClient(accessToken, refreshToken, expiryDate);
    const calendar = google.calendar({ version: 'v3', auth });

    try {
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin,
        timeMax,
        privateExtendedProperty: [`trainingPlanId=${trainingPlanId}`],
        singleEvents: true,
      });

      return response.data.items || [];
    } catch (error) {
      console.error('Error finding synced events:', error);
      return [];
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiryDate: number;
  }> {
    const client = this.createAuthClient('', refreshToken);

    try {
      const { credentials } = await client.refreshAccessToken();
      if (!credentials.access_token || !credentials.expiry_date) {
        throw new BadRequestException('Invalid credentials received');
      }
      return {
        accessToken: credentials.access_token,
        expiryDate: credentials.expiry_date,
      };
    } catch (error) {
      // Detect expired / revoked refresh token
      const errMsg =
        (error as any)?.response?.data?.error ||
        (error as any)?.message ||
        '';
      if (errMsg === 'invalid_grant') {
        throw new UnauthorizedException('invalid_grant');
      }
      console.error('Failed to refresh access token:', error);
      throw new BadRequestException('Failed to refresh access token');
    }
  }
}
