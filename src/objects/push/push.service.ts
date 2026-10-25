import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { DeviceToken } from './device-token.schema';

export type PushKind = 'messages' | 'plans' | 'connections';

export type NotificationPrefs = Record<PushKind, boolean>;

export const DEFAULT_PREFS: NotificationPrefs = {
  messages: true,
  plans: true,
  connections: true,
};

export interface PushPayload {
  title: string;
  body: string;
  /** An in-app screen; sent as com.fitai.app://open?to=<path>. */
  to: string;
}

/** FCM answers that mean the token will never work again. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Push notifications through Firebase Cloud Messaging.
 *
 * Off until FIREBASE_SERVICE_ACCOUNT (the service-account JSON, raw or
 * base64) is set: then every send is a no-op and the rest of the app is
 * untouched. Sending never throws — a message, an assignment or an invite is
 * saved before its push is attempted, and a push failure must not undo it.
 * The Firebase app is created on first use and kept for the life of the
 * serverless instance.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private app: App | null | undefined;

  constructor(
    @InjectModel('DeviceToken') private readonly tokenModel: Model<DeviceToken>,
    @InjectModel('User') private readonly userModel: Model<unknown>,
  ) {}

  /** The Firebase app, or null when push is not configured. */
  private firebase(): App | null {
    if (this.app !== undefined) return this.app;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
    if (!raw) {
      this.logger.log(
        'FIREBASE_SERVICE_ACCOUNT not set — push notifications are off.',
      );
      this.app = null;
      return null;
    }

    try {
      const json = raw.startsWith('{')
        ? raw
        : Buffer.from(raw, 'base64').toString('utf8');
      this.app =
        getApps().find((a) => a.name === 'fitai-push') ??
        initializeApp(
          { credential: cert(JSON.parse(json) as object) },
          'fitai-push',
        );
    } catch (error) {
      this.logger.error(
        'FIREBASE_SERVICE_ACCOUNT is set but unusable — push notifications are off.',
        error instanceof Error ? error.stack : String(error),
      );
      this.app = null;
    }
    return this.app;
  }

  async register(userId: string, token: string): Promise<void> {
    await this.tokenModel.updateOne(
      { token },
      {
        $set: {
          userId: new Types.ObjectId(userId),
          platform: 'android',
          lastSeenAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  async unregister(userId: string, token: string): Promise<void> {
    await this.tokenModel.deleteOne({
      token,
      userId: new Types.ObjectId(userId),
    });
  }

  async getPrefs(userId: string): Promise<NotificationPrefs> {
    const user = await this.userModel
      .findById(userId)
      .select('notificationPrefs')
      .lean<{ notificationPrefs?: Partial<NotificationPrefs> }>();
    return { ...DEFAULT_PREFS, ...(user?.notificationPrefs ?? {}) };
  }

  async setPrefs(
    userId: string,
    prefs: Partial<NotificationPrefs>,
  ): Promise<NotificationPrefs> {
    const set = Object.fromEntries(
      Object.entries(prefs).map(([kind, on]) => [
        `notificationPrefs.${kind}`,
        on,
      ]),
    );
    if (Object.keys(set).length > 0) {
      await this.userModel.updateOne({ _id: userId }, { $set: set });
    }
    return this.getPrefs(userId);
  }

  /** Send to every phone of one user. Never throws; resolves to the count delivered. */
  async sendToUser(
    userId: string,
    kind: PushKind,
    payload: PushPayload,
  ): Promise<number> {
    try {
      if (!isValidObjectId(userId)) return 0;
      const app = this.firebase();
      if (!app) return 0;

      const prefs = await this.getPrefs(userId);
      if (!prefs[kind]) return 0;

      const rows = await this.tokenModel
        .find({ userId: new Types.ObjectId(userId) })
        .select('token')
        .lean<{ token: string }[]>();
      const tokens = rows.map((r) => r.token);
      if (tokens.length === 0) return 0;
      const result = await getMessaging(app).sendEachForMulticast({
        tokens,
        notification: { title: payload.title, body: payload.body },
        data: { url: `com.fitai.app://open?to=${payload.to}` },
        android: {
          priority: 'high',
          notification: { channelId: 'fitai-push' },
        },
      });

      const dead = result.responses
        .map((r, i) =>
          !r.success && DEAD_TOKEN_CODES.has(r.error?.code ?? '')
            ? tokens[i]
            : null,
        )
        .filter((t): t is string => t !== null);
      if (dead.length > 0)
        await this.tokenModel.deleteMany({ token: { $in: dead } });

      return result.successCount;
    } catch (error) {
      this.logger.error(
        `Push to ${userId} (${kind}) failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }

  /** Fire and forget, for callers that have already saved what the push is about. */
  notify(userId: string, kind: PushKind, payload: PushPayload): void {
    void this.sendToUser(userId, kind, payload);
  }
}
