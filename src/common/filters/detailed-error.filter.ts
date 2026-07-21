import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { redact } from '../middleware/logger.middleware';

/**
 * NOTE: this filter is not currently registered anywhere. It is kept safe to
 * mount — the request body is redacted before logging — so enabling it cannot
 * start writing credentials to stdout.
 */
@Catch()
export class DetailedErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DetailedErrorFilter.name);

  catch(error: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    this.logger.error(
      `${request.method} ${request.url} failed: ${error.name}: ${error.message} ` +
        `body=${JSON.stringify(redact(request.body))} ` +
        `query=${JSON.stringify(redact(request.query))} ` +
        `params=${JSON.stringify(redact(request.params))}`,
      error.stack,
    );

    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      error: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}
