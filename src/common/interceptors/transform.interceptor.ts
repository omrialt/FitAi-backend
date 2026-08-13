import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';
import { Response } from '../../interfaces/response.interfaces';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, Response<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<Response<T> | T> {
    // Routes marked @RawResponse() return a body that is the payload itself —
    // a downloaded file — where the envelope would end up inside the file.
    const raw = this.reflector.get<boolean | undefined>(
      RAW_RESPONSE_KEY,
      context.getHandler(),
    );
    if (raw) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      map((data) => ({
        data,
        timestamp: new Date().toISOString(),
        path: request.url,
      })),
    );
  }
}
