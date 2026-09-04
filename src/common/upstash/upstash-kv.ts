import { Logger } from '@nestjs/common';

/**
 * The smallest possible shared key-value helper over Upstash's REST API.
 *
 * `UpstashRateLimitStore` already talks to Upstash this way and explains why
 * REST rather than a pooled Redis client: a serverless function freezes
 * between invocations, so a TCP connection is either torn down or left
 * dangling, while an HTTPS request per command is a shape a lambda can hold.
 *
 * This exists because a second thing in the app needs shared state for the
 * same reason the rate limiter did. `AlertService` deduplicates alerts in a
 * per-process `Map`, so a burst spread over five warm instances sends five
 * mails. That was written down as deliberate — erring toward extra mail
 * rather than silence — and it was the right call while nothing shared
 * existed. Now something does, and the honest version of "one alert per
 * cooldown" is one counter every instance can see.
 *
 * Deliberately not a Nest provider and deliberately tiny: two commands, no
 * client library, no connection lifecycle. Anything richer would be a Redis
 * abstraction, and this project does not have a second use for one yet.
 */

const logger = new Logger('UpstashKv');

export interface UpstashCredentials {
  url: string;
  token: string;
}

/** Present only when both variables are set; absent is a normal state. */
export function readUpstashCredentials(): UpstashCredentials | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) return null;

  return { url: url.replace(/\/+$/, ''), token };
}

export class UpstashKv {
  constructor(private readonly credentials: UpstashCredentials) {}

  /**
   * Claims `key` for `ttlSeconds`, atomically.
   *
   * Returns true only for the caller that created it. `SET key value NX EX n`
   * is one round trip and one command, which matters: a `GET` followed by a
   * `SET` would let two instances both read "absent" and both decide they are
   * the one to send. That race is the entire reason the in-memory version
   * could not simply be pointed at Redis.
   *
   * Throws on transport failure so the caller decides what "Redis is down"
   * means for its own feature — for alerting, it means send.
   */
  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const reply = await this.command([
      'SET',
      key,
      '1',
      'NX',
      'EX',
      String(Math.max(1, Math.ceil(ttlSeconds))),
    ]);

    // Upstash answers `"OK"` when the key was set and `null` when NX refused.
    return reply === 'OK';
  }

  async delete(key: string): Promise<void> {
    await this.command(['DEL', key]);
  }

  private async command(parts: string[]): Promise<unknown> {
    const response = await fetch(this.credentials.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(parts),
    });

    if (!response.ok) {
      throw new Error(`Upstash responded ${response.status}`);
    }

    const body = (await response.json()) as {
      result?: unknown;
      error?: string;
    };

    if (body.error) {
      throw new Error(`Upstash error: ${body.error}`);
    }

    return body.result;
  }
}

/** Built only when configured, so callers keep an explicit fallback path. */
export function createUpstashKv(): UpstashKv | null {
  const credentials = readUpstashCredentials();
  if (!credentials) return null;

  logger.log('Upstash credentials present — shared key-value state is active.');
  return new UpstashKv(credentials);
}
