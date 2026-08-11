import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from 'zod';
import { MongoError } from 'mongodb';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(error: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

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

    response.status(status).json({
      statusCode: status,
      message,
      details,
      // Omitted entirely rather than sent as null, so existing responses are
      // byte-identical to before for every error that does not carry a code.
      ...(code ? { code } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
