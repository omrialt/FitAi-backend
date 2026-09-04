import { z } from 'zod';

import { AnthropicService } from './anthropic.service';

/**
 * The interesting assertions here are the ones about `status`, not the ones
 * about happy-path parsing.
 *
 * The bug this whole class exists to prevent is not "the model returned
 * something odd" — it is "the feature was live for three weeks and nobody
 * noticed it had never once succeeded". So the tests that matter are: a key
 * with no successful call reports `lastOkAt: null`, a failure is recorded
 * rather than thrown, and a success clears the previous error.
 */

const schema = z.object({ answer: z.string() });
const jsonSchema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

const call = (service: AnthropicService) =>
  service.complete({
    label: 'test',
    jsonSchema,
    parser: schema,
    system: 'be brief',
    prompt: 'hello',
  });

/** Replaces the SDK's `messages.create` on an already-constructed service. */
function stubClient(service: AnthropicService, create: jest.Mock): void {
  (service as unknown as { client: unknown }).client = { messages: { create } };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"answer":"42"}' }],
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

describe('AnthropicService', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  describe('without a key', () => {
    beforeEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
    });

    it('is disabled and never claims to have run', () => {
      const service = new AnthropicService();

      expect(service.enabled).toBe(false);
      expect(service.status.lastCallAt).toBeNull();
      expect(service.status.lastOkAt).toBeNull();
    });

    it('returns null rather than throwing', async () => {
      const service = new AnthropicService();

      await expect(call(service)).resolves.toBeNull();
      expect(service.status.lastError).toBe('disabled');
    });
  });

  describe('with a key', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
    });

    /**
     * The distinction the status route was added for. A configured key is not
     * evidence of anything: this is the exact state the weekly review sat in
     * from 2026-08-29 until a human ran a manual trigger.
     */
    it('reports enabled but unproven before any call', () => {
      const service = new AnthropicService();

      expect(service.status).toMatchObject({
        enabled: true,
        lastCallAt: null,
        lastOkAt: null,
        calls: 0,
      });
    });

    it('parses a well-formed answer and counts its tokens', async () => {
      const service = new AnthropicService();
      stubClient(service, jest.fn().mockResolvedValue(message()));

      const result = await call(service);

      expect(result).toEqual({ data: { answer: '42' }, tokensUsed: 15 });
      expect(service.status.lastOkAt).not.toBeNull();
      expect(service.status.tokensUsed).toBe(15);
    });

    it('treats a refusal as no answer, not an error', async () => {
      const service = new AnthropicService();
      stubClient(
        service,
        jest.fn().mockResolvedValue(message({ stop_reason: 'refusal' })),
      );

      await expect(call(service)).resolves.toBeNull();
      expect(service.status.lastError).toContain('refused');
      // The call happened; it just produced nothing worth storing.
      expect(service.status.lastCallAt).not.toBeNull();
      expect(service.status.lastOkAt).toBeNull();
    });

    /**
     * Truncation and misbehaviour look identical downstream — both give
     * unparseable JSON — but only one of them is fixed by raising max_tokens.
     */
    it('names truncation separately from a bad answer', async () => {
      const service = new AnthropicService();
      stubClient(
        service,
        jest.fn().mockResolvedValue(message({ stop_reason: 'max_tokens' })),
      );

      await expect(call(service)).resolves.toBeNull();
      expect(service.status.lastError).toContain('max_tokens');
    });

    it('rejects an answer that does not match the schema', async () => {
      const service = new AnthropicService();
      stubClient(
        service,
        jest
          .fn()
          .mockResolvedValue(
            message({ content: [{ type: 'text', text: '{"answer":7}' }] }),
          ),
      );

      await expect(call(service)).resolves.toBeNull();
      expect(service.status.lastError).toContain('unparseable');
    });

    it('records a transport failure verbatim instead of throwing', async () => {
      const service = new AnthropicService();
      stubClient(
        service,
        jest.fn().mockRejectedValue(new Error('401 invalid x-api-key')),
      );

      await expect(call(service)).resolves.toBeNull();
      // A revoked key and an unreachable network are both "the feature did
      // nothing"; the message is the only thing that separates them.
      expect(service.status.lastError).toContain('401 invalid x-api-key');
    });

    it('clears a stale error once a call succeeds', async () => {
      const service = new AnthropicService();
      const create = jest
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(message());
      stubClient(service, create);

      await call(service);
      expect(service.status.lastError).not.toBeNull();

      await call(service);
      expect(service.status.lastError).toBeNull();
      expect(service.status.calls).toBe(2);
    });

    it('only pays for thinking when asked to', async () => {
      const service = new AnthropicService();
      const create = jest.fn().mockResolvedValue(message());
      stubClient(service, create);

      await call(service);
      expect(create.mock.calls[0][0]).not.toHaveProperty('thinking');

      await service.complete({
        label: 'test',
        jsonSchema,
        parser: schema,
        system: 's',
        prompt: 'p',
        thinking: true,
        effort: 'high',
      });
      expect(create.mock.calls[1][0]).toMatchObject({
        thinking: { type: 'adaptive' },
        output_config: expect.objectContaining({ effort: 'high' }),
      });
    });
  });
});
