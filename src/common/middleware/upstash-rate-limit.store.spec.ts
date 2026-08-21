import type { Options } from 'express-rate-limit';
import {
  UpstashRateLimitStore,
  createRateLimitStore,
  hasSharedRateLimitStore,
} from './upstash-rate-limit.store';

const URL = 'https://example.upstash.io';
const TOKEN = 'test-token';
const WINDOW = 60_000;

/** Builds the `{ result }` envelope Upstash returns for a pipeline. */
function ok(...results: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(results.map((result) => ({ result }))),
  } as unknown as Response;
}

/** Reads back the commands the store put on the wire. */
function commandsFrom(mock: jest.Mock, call = 0): unknown[][] {
  const [, init] = mock.mock.calls[call] as [string, RequestInit];
  return JSON.parse(init.body as string) as unknown[][];
}

describe('UpstashRateLimitStore', () => {
  let fetchMock: jest.Mock;
  let store: UpstashRateLimitStore;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    store = new UpstashRateLimitStore(URL, TOKEN);
    store.init({ windowMs: WINDOW } as Options);
  });

  it('reports a shared counter so the double-count check stays quiet', () => {
    expect(store.localKeys).toBe(false);
  });

  // Two limiters keyed on the same IP but with different windows must not
  // land on the same Redis key.
  it('namespaces keys by window length', () => {
    const hourly = new UpstashRateLimitStore(URL, TOKEN);
    hourly.init({ windowMs: 60 * WINDOW } as Options);
    expect(hourly.prefix).not.toBe(store.prefix);
  });

  describe('increment', () => {
    it('sets the expiry with the counter, then counts, then reads the ttl', async () => {
      fetchMock.mockResolvedValue(ok('OK', 1, 59_000));

      const result = await store.increment('1.2.3.4');

      // SET ... NX before INCR is what keeps a crash between the two from
      // leaving a counter with no expiry, i.e. a permanent lockout.
      expect(commandsFrom(fetchMock)).toEqual([
        ['SET', `${store.prefix}1.2.3.4`, '0', 'PX', WINDOW, 'NX'],
        ['INCR', `${store.prefix}1.2.3.4`],
        ['PTTL', `${store.prefix}1.2.3.4`],
      ]);
      expect(result.totalHits).toBe(1);
      expect(result.resetTime!.getTime()).toBeGreaterThan(Date.now());
    });

    it('sends the token as a bearer credential', async () => {
      fetchMock.mockResolvedValue(ok('OK', 1, 100));
      await store.increment('k');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${URL}/pipeline`);
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${TOKEN}`,
      );
    });

    it('counts across calls the way a shared store must', async () => {
      fetchMock
        .mockResolvedValueOnce(ok('OK', 1, 59_000))
        .mockResolvedValueOnce(ok(null, 2, 58_000));

      expect((await store.increment('k')).totalHits).toBe(1);
      expect((await store.increment('k')).totalHits).toBe(2);
    });

    // PTTL answers -1 (key with no expiry) or -2 (no key) when a window rolls
    // over mid-pipeline. Reporting either as a reset time in the past would
    // send a client a `Retry-After` it has already passed.
    it.each([-1, -2])('treats a ttl of %p as a fresh window', async (ttl) => {
      fetchMock.mockResolvedValue(ok('OK', 1, ttl));
      const { resetTime } = await store.increment('k');
      expect(resetTime!.getTime()).toBeGreaterThan(Date.now() + WINDOW - 1_000);
    });

    it('falls back to a local count rather than failing the request', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      // The limit degrades to per-instance — what it was before this store
      // existed — instead of throwing, which would 500 every caller, or
      // passing, which would lift the limit during an outage.
      expect((await store.increment('k')).totalHits).toBe(1);
      expect((await store.increment('k')).totalHits).toBe(2);
    });

    it('falls back when Upstash answers with an error status', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
      await expect(store.increment('k')).resolves.toEqual(
        expect.objectContaining({ totalHits: 1 }),
      );
    });

    it('falls back when a command inside the pipeline fails', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ error: 'WRONGTYPE' }]),
      } as unknown as Response);
      await expect(store.increment('k')).resolves.toEqual(
        expect.objectContaining({ totalHits: 1 }),
      );
    });
  });

  describe('decrement', () => {
    // `skipSuccessfulRequests` on the login limiter gives a hit back after a
    // correct sign-in. A plain DECR would recreate an expired key at -1 with
    // no expiry, so the guard runs inside Redis.
    it('only decrements a key that is still alive', async () => {
      fetchMock.mockResolvedValue(ok(0));
      await store.decrement('k');

      const [[command, script, numKeys, key]] = commandsFrom(fetchMock) as [
        [string, string, string, string],
      ];
      expect(command).toBe('EVAL');
      expect(script).toContain('EXISTS');
      expect(script).toContain('DECR');
      expect(numKeys).toBe('1');
      expect(key).toBe(`${store.prefix}k`);
    });

    it('swallows an outage instead of failing the response', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(store.decrement('k')).resolves.toBeUndefined();
    });
  });

  it('deletes the key on reset', async () => {
    fetchMock.mockResolvedValue(ok(1));
    await store.resetKey('k');
    expect(commandsFrom(fetchMock)).toEqual([['DEL', `${store.prefix}k`]]);
  });

  describe('get', () => {
    it('reports an unseen key as undefined rather than zero hits', async () => {
      fetchMock.mockResolvedValue(ok(null, -2));
      await expect(store.get('k')).resolves.toBeUndefined();
    });

    it('parses the string Redis returns for GET', async () => {
      fetchMock.mockResolvedValue(ok('7', 30_000));
      await expect(store.get('k')).resolves.toEqual(
        expect.objectContaining({ totalHits: 7 }),
      );
    });
  });
});

describe('createRateLimitStore', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('is undefined without credentials, so express-rate-limit keeps its MemoryStore', () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(createRateLimitStore()).toBeUndefined();
    expect(hasSharedRateLimitStore()).toBe(false);
  });

  it('needs both halves — a url with no token is not a working store', () => {
    process.env.UPSTASH_REDIS_REST_URL = URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(createRateLimitStore()).toBeUndefined();
  });

  it('builds a store when both are set', () => {
    process.env.UPSTASH_REDIS_REST_URL = URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = TOKEN;
    expect(createRateLimitStore()).toBeInstanceOf(UpstashRateLimitStore);
    expect(hasSharedRateLimitStore()).toBe(true);
  });

  // A store carries the window from init(), so one object shared between the
  // 1-minute global limiter and the 60-minute register limiter would apply
  // whichever initialised last to both.
  it('hands out a fresh instance per limiter', () => {
    process.env.UPSTASH_REDIS_REST_URL = URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = TOKEN;
    expect(createRateLimitStore()).not.toBe(createRateLimitStore());
  });

  it('tolerates a trailing slash on the url', async () => {
    process.env.UPSTASH_REDIS_REST_URL = `${URL}/`;
    process.env.UPSTASH_REDIS_REST_TOKEN = TOKEN;
    const fetchMock = jest.fn().mockResolvedValue(ok('OK', 1, 100));
    global.fetch = fetchMock as unknown as typeof fetch;

    const built = createRateLimitStore()!;
    built.init!({ windowMs: WINDOW } as Options);
    await built.increment('k');

    const [requestedUrl] = fetchMock.mock.calls[0] as [string];
    expect(requestedUrl).toBe(`${URL}/pipeline`);
  });
});
