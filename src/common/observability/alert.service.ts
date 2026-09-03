import { Injectable, Logger } from '@nestjs/common';
import { NodemailerService } from '../nodemailer/nodemailer.service';
import { createUpstashKv, UpstashKv } from '../upstash/upstash-kv';

/** How long the same alert stays suppressed after being sent. */
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

export interface AlertInput {
  /** Groups repeats of the same problem. Must not contain volatile parts. */
  fingerprint: string;
  subject: string;
  /** Rendered into the mail body as plain lines. */
  detail: Record<string, unknown>;
}

/**
 * Sends operational alerts by email, reusing the Nodemailer transport the app
 * already configures for password resets.
 *
 * Why email and not a vendor: the gap analysis' own example is a deploy that
 * locked three accounts out for minutes with nothing to announce it. Any
 * channel that reaches a human fixes that; a channel that needs an account,
 * a DSN and a paid tier does not exist until someone signs up. This works with
 * the credentials already in the environment.
 *
 * Deduplication is shared when it can be. With Upstash configured, the
 * cooldown is a single `SET NX EX` that every instance races for and exactly
 * one wins — the same dependency, and the same reasoning, as the rate-limit
 * store. Without it the cooldown falls back to a per-process `Map`, which on
 * Vercel means one mail per warm lambda.
 *
 * The fallback direction is deliberate and stays deliberate: when the shared
 * counter is absent *or unreachable*, this errs toward extra mail rather than
 * toward silence. The failure being fixed was a deploy that locked three
 * accounts out with nothing to announce it; a duplicate alert is noise, a
 * missing one is that outage again.
 *
 * What it still does NOT claim to be: aggregation, search, or counting.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  /** Used when Upstash is absent, and when it is present but not answering. */
  private readonly recentlySent = new Map<string, number>();
  private readonly shared: UpstashKv | null;

  constructor(private readonly mailer: NodemailerService) {
    this.shared = createUpstashKv();
    this.logger.log(
      this.shared
        ? 'Alert de-duplication is shared across instances.'
        : 'Alert de-duplication is per-instance — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to share it.',
    );
  }

  /** True when the cooldown is a counter every instance sees. */
  get deduplicationIsShared(): boolean {
    return this.shared !== null;
  }

  /** Where alerts go. Unset means alerting is off. */
  private get recipient(): string | undefined {
    return process.env.ALERT_EMAIL?.trim() || undefined;
  }

  private get cooldownMs(): number {
    const configured = Number(process.env.ALERT_COOLDOWN_MS);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_COOLDOWN_MS;
  }

  /**
   * Raise an alert. Never throws and never rejects: alerting sits in the error
   * path, and an alert that fails must not become a second failure that
   * replaces the original one in the logs.
   */
  async raise(input: AlertInput): Promise<void> {
    try {
      // Log unconditionally, even when suppressed or unconfigured. The log is
      // the record; the mail is only the notification.
      this.logger.warn(
        `ALERT ${input.fingerprint}: ${input.subject} ${JSON.stringify(input.detail)}`,
      );

      const to = this.recipient;
      if (!to) return;
      if (await this.isSuppressed(input.fingerprint)) return;

      await this.mailer.sendOperationalAlert(to, input.subject, input.detail);
    } catch (error) {
      this.logger.error(
        `Failed to deliver alert ${input.fingerprint}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Whether this alert has already been sent inside its cooldown.
   *
   * Claiming the window and reporting suppression are the same operation on
   * purpose. Checking first and marking afterwards is exactly the race that
   * lets two instances both decide they are the sender, and the shared store
   * only removes that race if nobody reintroduces it here.
   */
  private async isSuppressed(fingerprint: string): Promise<boolean> {
    if (this.shared) {
      try {
        const won = await this.shared.claim(
          `alert:${fingerprint}`,
          this.cooldownMs / 1000,
        );
        return !won;
      } catch (error) {
        // Redis being unreachable must not silence an alert — that would make
        // the observability feature fail in the one direction it exists to
        // prevent. Fall through to the local map and accept the duplicates.
        this.logger.warn(
          `Shared alert de-duplication unavailable, falling back to per-instance: ${(error as Error).message}`,
        );
      }
    }

    const now = Date.now();
    const last = this.recentlySent.get(fingerprint);

    if (last !== undefined && now - last < this.cooldownMs) {
      return true;
    }

    this.recentlySent.set(fingerprint, now);

    // Opportunistic cleanup so a long-lived instance does not accumulate an
    // entry per distinct fingerprint forever.
    for (const [key, sentAt] of this.recentlySent) {
      if (now - sentAt >= this.cooldownMs) this.recentlySent.delete(key);
    }

    return false;
  }
}
