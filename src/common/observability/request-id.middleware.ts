import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Header carrying the correlation id, in and out. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Reads the id this request was tagged with, if the middleware has run. */
export function getRequestId(req: unknown): string | undefined {
  const candidate = req as { requestId?: unknown } | null | undefined;
  return typeof candidate?.requestId === 'string'
    ? candidate.requestId
    : undefined;
}

/**
 * Tags every request with a correlation id.
 *
 * The point is joining things up after the fact. A user reports "it failed at
 * about 3pm"; without an id the only way to find their request among a day of
 * logs is guessing from timestamps and paths. The id is returned in the
 * response header and included in error bodies, so a screenshot of the failure
 * carries the key to its own log line.
 *
 * An inbound `x-request-id` is honoured rather than replaced, so a chain of
 * calls shares one id. It is length-capped and stripped of anything but safe
 * characters first — it lands in log lines, and an attacker-controlled string
 * with newlines in it can forge whole entries.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const supplied = Array.isArray(inbound) ? inbound[0] : inbound;

    const safe =
      typeof supplied === 'string'
        ? supplied.replace(/[^\w.-]/g, '').slice(0, 64)
        : '';

    const requestId = safe || randomUUID();

    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
