import { Injectable, Logger } from '@nestjs/common';
import { NodemailerService } from '../nodemailer/nodemailer.service';

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
 * What it does NOT claim to be: aggregation, search, or accurate counting.
 * Deduplication is per-process, and on Vercel each warm lambda has its own
 * memory, so a burst spread over instances can send one mail per instance.
 * That is deliberately the safe direction — this errs toward extra mail rather
 * than toward silence, which is the failure being fixed. Exact counting needs
 * shared state, the same dependency N-04 needs for rate limiting.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly recentlySent = new Map<string, number>();

  constructor(private readonly mailer: NodemailerService) {}

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
      if (this.isSuppressed(input.fingerprint)) return;

      this.recentlySent.set(input.fingerprint, Date.now());
      await this.mailer.sendOperationalAlert(to, input.subject, input.detail);
    } catch (error) {
      this.logger.error(
        `Failed to deliver alert ${input.fingerprint}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private isSuppressed(fingerprint: string): boolean {
    const now = Date.now();
    const last = this.recentlySent.get(fingerprint);

    if (last !== undefined && now - last < this.cooldownMs) {
      return true;
    }

    // Opportunistic cleanup so a long-lived instance does not accumulate an
    // entry per distinct fingerprint forever.
    for (const [key, sentAt] of this.recentlySent) {
      if (now - sentAt >= this.cooldownMs) this.recentlySent.delete(key);
    }

    return false;
  }
}
