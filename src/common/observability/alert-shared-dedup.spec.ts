import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import { AlertService } from './alert.service';
import { NodemailerService } from '../nodemailer/nodemailer.service';

/**
 * Proves the alert cooldown is actually shared, using the pattern that worked
 * for the rate-limit store in round 5: a local HTTP server mimicking Upstash's
 * REST endpoint, and *separate service instances* racing for the same key.
 *
 * Separate instances is the whole test. A single `AlertService` would suppress
 * a repeat from its in-memory map alone and pass this suite while the Redis
 * call did nothing — which is precisely the failure mode being fixed, and
 * exactly how N-04 shipped green and inert. Three instances stand in for three
 * warm lambdas, and only a counter outside all of them can produce one mail.
 */

/** A `SET key value NX EX n` good enough to be raced against. */
function fakeUpstash(): Promise<{ server: Server; url: string; keys: Set<string> }> {
  const keys = new Set<string>();

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const command = JSON.parse(body || '[]') as string[];
      const [verb, key, , nx] = command;

      let result: unknown = null;
      if (verb === 'SET' && nx === 'NX') {
        if (!keys.has(key)) {
          keys.add(key);
          result = 'OK';
        }
      } else if (verb === 'DEL') {
        keys.delete(key);
        result = 1;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, keys });
    });
  });
}

describe('AlertService — shared de-duplication', () => {
  const ORIGINAL_ENV = { ...process.env };

  let server: Server;
  let url: string;
  let mailer: { sendOperationalAlert: jest.Mock };

  const alert = (fingerprint = 'shared:one') => ({
    fingerprint,
    subject: 'Something broke',
    detail: { path: '/x' },
  });

  /** Constructed after the env is set — the store is chosen in the constructor. */
  const instance = () =>
    new AlertService(mailer as unknown as NodemailerService);

  beforeEach(async () => {
    ({ server, url } = await fakeUpstash());
    mailer = { sendOperationalAlert: jest.fn().mockResolvedValue(undefined) };

    process.env.ALERT_EMAIL = 'ops@example.com';
    process.env.ALERT_COOLDOWN_MS = '60000';
    process.env.UPSTASH_REDIS_REST_URL = url;
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    await new Promise((resolve) => server.close(resolve));
  });

  it('reports that de-duplication is shared', () => {
    expect(instance().deduplicationIsShared).toBe(true);
  });

  it('falls back to per-instance when only one variable is set', () => {
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    expect(instance().deduplicationIsShared).toBe(false);
  });

  // The claim this round is making. Before it, these were three mails.
  it('sends one mail when three instances hit the same problem', async () => {
    const instances = [instance(), instance(), instance()];

    await Promise.all(instances.map((service) => service.raise(alert())));

    expect(mailer.sendOperationalAlert).toHaveBeenCalledTimes(1);
  });

  it('still lets a different problem through', async () => {
    await instance().raise(alert('shared:one'));
    await instance().raise(alert('shared:two'));

    expect(mailer.sendOperationalAlert).toHaveBeenCalledTimes(2);
  });

  /**
   * The direction of the fallback is the point, and it is worth a test of its
   * own because it is counter-intuitive: when the shared counter is broken,
   * this sends *more* mail, not less. Alerting exists because a deploy once
   * locked three accounts out with nothing to announce it — a duplicate alert
   * is noise, a missing one is that outage happening again unseen.
   */
  it('sends rather than goes quiet when Upstash is unreachable', async () => {
    await new Promise((resolve) => server.close(resolve));

    const service = instance();
    await service.raise(alert());

    expect(mailer.sendOperationalAlert).toHaveBeenCalledTimes(1);

    // And having fallen back, it still suppresses within its own process.
    await service.raise(alert());
    expect(mailer.sendOperationalAlert).toHaveBeenCalledTimes(1);

    server = createServer();
  });
});
