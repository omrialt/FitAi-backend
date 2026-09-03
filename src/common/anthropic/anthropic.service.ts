import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { ZodSchema } from 'zod';

/**
 * The one Anthropic client in the application.
 *
 * The weekly review built its own client inline, which was right when it was
 * the only AI in the project. It is now one of four, and four copies of "read
 * the key, decide whether to construct a client, remember to check
 * `stop_reason` before reading `content`, remember that a model's JSON is
 * still untrusted input" is four chances to get one of them wrong.
 *
 * The part worth reading here is `lastCallAt` / `lastError`.
 *
 * Every revision of the gap analysis has recorded the same class of failure:
 * a feature ships, its code is correct, and it quietly does nothing because a
 * variable was never set — the rate limiter counting per-lambda, the alerting
 * with no recipient, the review with no key. `enabled` only answers "is a key
 * present". It does not answer "has this ever worked", and those are different
 * questions: a key can be present and revoked, present and out of credit,
 * present and typo'd. Until a request comes back, nobody knows.
 *
 * So the service records the outcome of every call and exposes it. That is
 * what turns "deployed" and "in effect" back into two claims that can be
 * checked separately, from outside, without spending a token.
 */

/** Adaptive thinking is worth its cost on advice; not on a lookup. */
export type Effort = 'low' | 'medium' | 'high';

export const DEFAULT_MODEL = 'claude-opus-5';

export interface CompleteOptions<T> {
  /** Constrains the model on the way out. Same shape as JSON Schema. */
  jsonSchema: Record<string, unknown>;
  /** Validates it on the way in. Belt and braces on the one non-deterministic boundary. */
  parser: ZodSchema<T>;
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: Effort;
  /** Adaptive thinking costs tokens; a parse or a lookup does not need it. */
  thinking?: boolean;
  /** Names the call in logs and in `lastError`. */
  label: string;
}

export interface CompleteResult<T> {
  data: T;
  tokensUsed: number;
}

/** Why a call produced nothing. All of these are ordinary, none are 500s. */
export type AiFailure =
  | 'disabled'
  | 'refused'
  | 'unparseable'
  | 'transport'
  | 'max_tokens';

export interface AiStatus {
  enabled: boolean;
  model: string;
  /** When a request last came back — success or failure. `null` means never called. */
  lastCallAt: string | null;
  lastOkAt: string | null;
  /** The most recent failure reason, cleared by the next success. */
  lastError: string | null;
  calls: number;
  tokensUsed: number;
}

/** A model's answer is data, not code — malformed must not throw. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic | null;

  private lastCallAt: Date | null = null;
  private lastOkAt: Date | null = null;
  private lastError: string | null = null;
  private calls = 0;
  private tokensUsed = 0;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    this.client = apiKey ? new Anthropic({ apiKey }) : null;

    this.logger.log(
      this.client
        ? `Anthropic client ready (${DEFAULT_MODEL}). No call has been made yet — /ai-review/status reports the first one.`
        : 'ANTHROPIC_API_KEY is not set — every AI feature is inert.',
    );
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Counters are per-process, like every other in-memory total in this app.
   * On Vercel that means per warm lambda, so `calls` is a sample and not a
   * bill. It is here to answer "did anything work", which one instance can
   * answer honestly; it is not accounting, and does not pretend to be.
   */
  get status(): AiStatus {
    return {
      enabled: this.enabled,
      model: DEFAULT_MODEL,
      lastCallAt: this.lastCallAt?.toISOString() ?? null,
      lastOkAt: this.lastOkAt?.toISOString() ?? null,
      lastError: this.lastError,
      calls: this.calls,
      tokensUsed: this.tokensUsed,
    };
  }

  /**
   * One structured completion.
   *
   * Returns `null` for every ordinary reason to have no answer, rather than
   * throwing: a refusal, an unparseable body and an unreachable API are all
   * "no review this week", and a caller that has to distinguish them in a
   * `catch` will eventually stop distinguishing them at all. The reason is
   * recorded in `lastError` for whoever is debugging, not raised at whoever
   * is training.
   */
  async complete<T>(
    options: CompleteOptions<T>,
  ): Promise<CompleteResult<T> | null> {
    if (!this.client) {
      this.lastError = 'disabled';
      return null;
    }

    this.calls += 1;
    this.lastCallAt = new Date();

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: options.maxTokens ?? 8000,
        ...(options.thinking ? { thinking: { type: 'adaptive' as const } } : {}),
        output_config: {
          effort: options.effort ?? 'medium',
          format: { type: 'json_schema', schema: options.jsonSchema },
        },
        system: options.system,
        messages: [{ role: 'user', content: options.prompt }],
      });
    } catch (error) {
      // The network, the key and the credit balance all fail here, and all of
      // them look identical to the user: the feature did nothing. The message
      // is what separates them, so it is kept verbatim.
      return this.fail(options.label, 'transport', (error as Error).message);
    }

    // A refusal is a 200 with no usable content, so this is checked before
    // `content` is read at all.
    if (response.stop_reason === 'refusal') {
      return this.fail(options.label, 'refused');
    }

    // Truncation yields valid-looking prose and invalid JSON. Naming it
    // separately is the difference between "the model misbehaved" and "raise
    // maxTokens", which are not the same bug.
    if (response.stop_reason === 'max_tokens') {
      return this.fail(options.label, 'max_tokens');
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const parsed = options.parser.safeParse(safeJson(text));
    if (!parsed.success) {
      return this.fail(options.label, 'unparseable', parsed.error.message);
    }

    const tokens = response.usage.input_tokens + response.usage.output_tokens;
    this.tokensUsed += tokens;
    this.lastOkAt = new Date();
    this.lastError = null;

    return { data: parsed.data, tokensUsed: tokens };
  }

  private fail(label: string, reason: AiFailure, detail?: string): null {
    this.lastError = detail ? `${label}: ${reason} — ${detail}` : `${label}: ${reason}`;
    this.logger.warn(`AI call failed — ${this.lastError}`);
    return null;
  }
}
