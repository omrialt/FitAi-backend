import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Field names whose values must never reach the logs. Matched
 * case-insensitively against top-level and nested keys.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'resetpasswordtoken',
  'authorization',
  'secret',
  'clientsecret',
  'apikey',
]);

const REDACTED = '[REDACTED]';

/**
 * Deep-copies a payload, replacing sensitive values with a placeholder.
 * This middleware is generic, so it redacts regardless of which routes it is
 * currently mounted on — mounting it on an auth route must not start writing
 * credentials to stdout.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_FIELDS.has(key.toLowerCase())
      ? REDACTED
      : redact(val, depth + 1);
  }
  return out;
}

function hasEntries(value: unknown): boolean {
  return !!value && typeof value === 'object' && Object.keys(value).length > 0;
}

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(LoggerMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    try {
      const start = Date.now();
      const parts = [`${req.method} ${req.originalUrl}`];

      if (hasEntries(req.body)) {
        parts.push(`body=${JSON.stringify(redact(req.body))}`);
      }
      if (hasEntries(req.query)) {
        parts.push(`query=${JSON.stringify(redact(req.query))}`);
      }

      this.logger.debug(parts.join(' '));

      res.on('finish', () => {
        this.logger.debug(
          `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`,
        );
      });
    } catch (error) {
      this.logger.error(
        'Logger middleware error',
        error instanceof Error ? error.stack : String(error),
      );
    }

    next();
  }
}
