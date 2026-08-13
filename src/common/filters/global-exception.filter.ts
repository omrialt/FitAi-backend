import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { MongoError } from 'mongodb';
import { AlertService } from '../observability/alert.service';
import { getRequestId } from '../observability/request-id.middleware';

/**
 * Turns every thrown error into the app's response shape — and, since this is
 * the one place every failure passes through, records that it happened.
 *
 * It previously did the first job only: a 500 was serialised to the client and
 * nothing was written anywhere. The single most load-bearing line in the whole
 * observability story is the `logger.error` below, because without it a crash
 * in production left no trace at all.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  // Optional so the filter still works anywhere it is constructed without the
  // observability module present — tests instantiate it directly.
  constructor(private readonly alerts?: AlertService) {}

  catch(error: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    // Not every execution context carries an HTTP request — this filter is
    // global and the app also loads the socket.io platform — so the request is
    // treated as optional throughout rather than assumed.
    const request =
      typeof ctx.getRequest === 'function'
        ? ctx.getRequest<Request>()
        : undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = error.message;
    let details: unknown = null;
    // Machine-readable discriminator, when the thrower supplied one. Without
    // it the only thing a client can branch on is the human message, which is
    // translated and rephrased freely — so any such check breaks silently.
    let code: string | null = null;

    if (error instanceof HttpException) {
      status = error.getStatus();
      const response = error.getResponse();

      if (typeof response === 'string') {
        message = response;
        details = null;
      } else if (
        typeof response === 'object' &&
        response !== null &&
        'message' in response
      ) {
        message = (response as { message: string }).message;
        details =
          'error' in response
            ? ((response as { error?: string }).error ?? null)
            : null;
        code =
          'code' in response
            ? ((response as { code?: string }).code ?? null)
            : null;
      }
    } else if (error instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Validation failed';

      details = error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
    } else if (error instanceof MongoError) {
      if (error.code === 11000) {
        status = HttpStatus.CONFLICT;
        message = 'Duplicate key error';
        details = error.message;
      }
    }

    const requestId = getRequestId(request);

    this.record(error, status, request, requestId);

    response.status(status).json({
      statusCode: status,
      message,
      details,
      // Omitted entirely rather than sent as null, so existing responses are
      // byte-identical to before for every error that does not carry a code.
      ...(code ? { code } : {}),
      // Returned so a user reporting a failure can quote the id that finds its
      // log line. It identifies a request, not a person, and reveals nothing
      // about the error itself.
      ...(requestId ? { requestId } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log the failure, and alert on the ones that mean the server is broken.
   *
   * 5xx is "we broke"; 4xx is "the caller was refused", which is routine and
   * would drown the log at error level. Both are recorded, at levels that let
   * one be searched for and the other be alerted on.
   */
  private record(
    error: Error,
    status: number,
    request: Request | undefined,
    requestId: string | undefined,
  ): void {
    const context = {
      requestId,
      method: request?.method,
      path: request?.originalUrl ?? request?.url,
      status,
      // Id only. Logging the user object here is what leaked PII to stdout on
      // every request before Phase 4.
      userId: (request as { user?: { id?: string } } | undefined)?.user?.id,
      error: error.name,
      message: error.message,
    };

    const line = JSON.stringify(context);

    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(line, error.stack);

      // The route pattern (`/users/:id`) rather than the concrete path, so a
      // thousand different ids fingerprint as one problem. Express types this
      // as `any`, hence the narrowing.
      const routePath = (request as { route?: { path?: unknown } } | undefined)
        ?.route?.path;

      void this.alerts?.raise({
        // Fingerprint on the shape of the failure, not the instance: the same
        // bug hit a thousand times is one thing to be told about. The path is
        // included but not the query string, which carries ids and values.
        fingerprint: `5xx:${error.name}:${request?.method ?? '?'}:${
          typeof routePath === 'string'
            ? routePath
            : (request?.path ?? 'unknown')
        }`,
        subject: `${status} on ${request?.method ?? '?'} ${request?.path ?? 'unknown'}`,
        detail: {
          ...context,
          stack: error.stack?.split('\n').slice(0, 8).join('\n'),
        },
      });
    } else {
      this.logger.debug(line);
    }
  }
}
