import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class DetailedErrorFilter implements ExceptionFilter {
  catch(error: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    console.log('⚠️ Detailed Error Log:');
    console.log('URL:', request.url);
    console.log('Method:', request.method);
    console.log('Body:', request.body);
    console.log('Query:', request.query);
    console.log('Params:', request.params);
    console.log('Error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

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