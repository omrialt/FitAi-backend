import { Logger } from '@nestjs/common';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';

/**
 * Request rate limiting.
 *
 * `express-rate-limit` was already a dependency but was never mounted, so
 * `/auth/login`, `/auth/register` and `/auth/forgot-password` accepted an
 * unbounded number of attempts — credential stuffing on the first, and a mail
 * relay that burns the Gmail app-password quota on the last.
 *
 * Two tiers:
 *   - `globalLimiter` is a wide backstop against a single client hammering the
 *     whole API. It is generous enough that normal dashboard use (which fires
 *     seven parallel requests on load) never reaches it.
 *   - `authLimiter` is deliberately tight and applies only to the credential
 *     endpoints, where a legitimate user makes a handful of attempts at most.
 *
 * Caveat worth knowing: the store is in-memory, so on Vercel each warm lambda
 * counts separately and the effective ceiling is (limit x live instances).
 * That still removes the single-instance flood, but a distributed store
 * (Redis/Upstash) is what makes the number exact.
 */

const logger = new Logger('RateLimit');

const MINUTE = 60 * 1000;

/** Shared behaviour: log the block, answer JSON in the app's error shape. */
function baseOptions(scope: string): Partial<Options> {
  return {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req: Request, res, _next, options) => {
      logger.warn(
        `${scope} limit hit by ${req.ip ?? 'unknown ip'} on ${req.method} ${req.originalUrl}`,
      );
      res.status(options.statusCode).json({
        statusCode: options.statusCode,
        message: 'Too many requests, please try again later',
        error: 'Too Many Requests',
      });
    },
  };
}

/** Wide backstop for every route. */
export const globalLimiter = rateLimit({
  ...baseOptions('Global'),
  windowMs: MINUTE,
  limit: 300,
});

/**
 * Sign-in attempts. Successful requests are not counted, so a user who logs in
 * correctly on the first try never spends budget — only failures and
 * credential-stuffing do.
 */
export const loginLimiter = rateLimit({
  ...baseOptions('Login'),
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
});

/**
 * Sign-ups get their own instance rather than sharing the login store.
 * `rateLimit()` builds a store per call, so a shared limiter would mean a burst
 * of failed logins from an office NAT also locks new users out of registering —
 * two unrelated problems answering to one counter.
 */
export const registerLimiter = rateLimit({
  ...baseOptions('Register'),
  windowMs: 60 * MINUTE,
  limit: 10,
});

/**
 * Token endpoints: refresh, password reset, verification resend. Attempts here
 * are guesses at a secret, so failures are what matter.
 */
export const tokenLimiter = rateLimit({
  ...baseOptions('Token'),
  windowMs: 15 * MINUTE,
  limit: 20,
  skipSuccessfulRequests: true,
});

/**
 * Password reset is limited by email address as well as by IP: limiting by IP
 * alone still lets one attacker mail-bomb a victim from a handful of
 * addresses. Falls back to the IP when no email was supplied.
 */
export const forgotPasswordLimiter = rateLimit({
  ...baseOptions('ForgotPassword'),
  windowMs: 60 * MINUTE,
  limit: 5,
  keyGenerator: (req: Request) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof email === 'string') {
      // Namespaced so an address can never collide with an IP-derived key.
      return `email:${email.toLowerCase()}`;
    }
    // `ipKeyGenerator` rather than `req.ip`: a single IPv6 address is one of
    // trillions handed to the same customer, so keying on the raw address
    // lets a v6 client sidestep the limit by rotating within its own /64.
    return ipKeyGenerator(req.ip ?? '');
  },
});

/**
 * Which limiter guards which path, kept here so create-app.ts stays
 * declarative. Paths sharing an entry share a counter by design.
 */
export const RATE_LIMITED_PATHS: Array<{
  paths: string[];
  limiter: RequestHandler;
}> = [
  { paths: ['/auth/login'], limiter: loginLimiter },
  { paths: ['/auth/register'], limiter: registerLimiter },
  {
    paths: [
      '/auth/refresh',
      '/auth/reset-password',
      '/auth/verify-email',
      '/auth/resend-verification',
      // The Google handoff code is a bearer secret like the rest of these:
      // 64 hex characters, single-use, and worth guessing at only if guesses
      // are free.
      '/auth/google/exchange',
    ],
    limiter: tokenLimiter,
  },
];
