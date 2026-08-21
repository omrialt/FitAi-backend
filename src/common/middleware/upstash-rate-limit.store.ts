import { Logger } from '@nestjs/common';
import { MemoryStore } from 'express-rate-limit';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';

/**
 * A shared hit counter for `express-rate-limit`, backed by Upstash Redis.
 *
 * Why this exists: the default `MemoryStore` lives inside one process. On
 * Vercel each warm lambda holds its own copy, so the real ceiling was
 * `limit x live instances` rather than the number written in the code — the
 * limiters removed a single-instance flood but never enforced an exact number.
 * A store every instance shares is what makes the number mean what it says.
 *
 * Why Upstash's REST API and not a Redis client: serverless functions freeze
 * between invocations, so a pooled TCP connection is either torn down or left
 * dangling. The REST endpoint is a plain HTTPS request per command, which is
 * the shape a lambda can actually hold. It also keeps the dependency list
 * unchanged — this talks to it with `fetch`.
 *
 * Configuration is optional. With no credentials set, `createRateLimitStore`
 * returns `undefined` and `express-rate-limit` falls back to its in-memory
 * store, so local dev and the container deployment keep working untouched.
 */

const logger = new Logger('RateLimitStore');

/** Upstash pipeline responses are `{ result }` on success, `{ error }` on failure. */
type PipelineReply = { result?: unknown; error?: string };

function readNumber(reply: PipelineReply | undefined): number | undefined {
  const value = reply?.result;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export class UpstashRateLimitStore implements Store {
  /** The counter is shared, which is the whole point — tell the double-count check so. */
  localKeys = false;

  prefix = 'rl:';

  private windowMs = 60_000;

  /**
   * Used only while Redis is unreachable. Losing the shared count is bad; going
   * completely unlimited, or returning 500 to every caller because the counter
   * is down, is worse. See `withFallback`.
   */
  private readonly fallback = new MemoryStore();

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
    // Namespacing by window keeps limiters with different windows from sharing
    // a counter when they happen to key off the same IP.
    this.prefix = `rl:${options.windowMs}:`;
    this.fallback.init(options);
  }

  /**
   * Sends a pipeline of Redis commands in a single HTTPS round trip.
   * Throws on transport failure or on any command-level error, so callers can
   * treat "Redis did not answer" as one case.
   */
  private async pipeline(commands: unknown[][]): Promise<PipelineReply[]> {
    const response = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      // A rate limiter must never be the slowest thing in a request. If Redis
      // has not answered in two seconds, fall back rather than make the caller
      // wait for it.
      signal: AbortSignal.timeout(2_000),
    });

    if (!response.ok) {
      throw new Error(`Upstash responded ${response.status}`);
    }

    const body = (await response.json()) as PipelineReply[];
    const failed = body.find((reply) => reply?.error);
    if (failed) {
      throw new Error(`Upstash command failed: ${failed.error}`);
    }
    return body;
  }

  /**
   * Runs `operation` against Redis, and on failure runs `local` against the
   * per-instance store instead.
   *
   * Failing over rather than throwing is deliberate: an outage in the counter
   * should degrade the limit back to what it was before this store existed
   * (per-instance, approximate) — not take the API down with it, and not lift
   * the limit entirely.
   */
  private async withFallback<T>(
    operation: () => Promise<T>,
    local: () => Promise<T> | T,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      logger.warn(
        `Redis counter unavailable, falling back to per-instance memory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return local();
    }
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    return this.withFallback(
      async () => {
        const redisKey = `${this.prefix}${key}`;
        const replies = await this.pipeline([
          // `SET .. PX .. NX` creates the counter at zero *with* its expiry only
          // when it is absent, so the window starts on the first hit and is
          // never extended by later ones. Doing it this way instead of
          // `INCR` + `EXPIRE` avoids the case where the process dies between
          // the two and leaves a counter that never expires — a client
          // permanently locked out.
          ['SET', redisKey, '0', 'PX', this.windowMs, 'NX'],
          ['INCR', redisKey],
          ['PTTL', redisKey],
        ]);

        const totalHits = readNumber(replies[1]);
        if (totalHits === undefined) {
          throw new Error('Upstash returned no counter value');
        }

        // PTTL answers -1 (no expiry) or -2 (no key) in races; treat either as
        // a fresh window rather than reporting a reset time in the past.
        const ttl = readNumber(replies[2]) ?? -1;
        const resetTime = new Date(
          Date.now() + (ttl >= 0 ? ttl : this.windowMs),
        );

        return { totalHits, resetTime };
      },
      () => this.fallback.increment(key),
    );
  }

  /**
   * Gives a hit back. `skipSuccessfulRequests` on the login and token limiters
   * relies on this, so a user who signs in correctly spends no budget.
   */
  async decrement(key: string): Promise<void> {
    await this.withFallback(
      async () => {
        // Only decrement a counter that still exists: if the window has already
        // rolled over, `DECR` would recreate the key at -1 with no expiry.
        await this.pipeline([
          ['EVAL', DECREMENT_IF_PRESENT, '1', `${this.prefix}${key}`],
        ]);
      },
      () => this.fallback.decrement(key),
    );
  }

  async resetKey(key: string): Promise<void> {
    await this.withFallback(
      async () => {
        await this.pipeline([['DEL', `${this.prefix}${key}`]]);
      },
      () => this.fallback.resetKey(key),
    );
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    return this.withFallback(
      async () => {
        const redisKey = `${this.prefix}${key}`;
        const replies = await this.pipeline([
          ['GET', redisKey],
          ['PTTL', redisKey],
        ]);

        const totalHits = readNumber(replies[0]);
        if (totalHits === undefined) return undefined;

        const ttl = readNumber(replies[1]) ?? -1;
        return {
          totalHits,
          resetTime:
            ttl >= 0 ? new Date(Date.now() + ttl) : new Date(Date.now()),
        };
      },
      () => this.fallback.get(key),
    );
  }

  shutdown(): void {
    this.fallback.shutdown();
  }
}

/**
 * Decrement, but only while the key is alive. Keeps a late `decrement` — one
 * arriving after its window expired — from resurrecting the counter as a
 * never-expiring -1.
 */
const DECREMENT_IF_PRESENT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

/**
 * Builds the shared store when Upstash credentials are configured.
 *
 * Returns `undefined` otherwise, which is the signal to `express-rate-limit`
 * to use its own `MemoryStore`. Every limiter needs its own instance — the
 * store holds the window from `init()`, so sharing one object across limiters
 * with different windows would make the last one to initialise win.
 */
export function createRateLimitStore(): Store | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    return undefined;
  }

  return new UpstashRateLimitStore(url.replace(/\/+$/, ''), token);
}

/** True when the limiters are counting in a store every instance shares. */
export function hasSharedRateLimitStore(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}
