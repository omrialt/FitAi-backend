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
      timestamp: new Date().toISOString(),
    });
  }
}
