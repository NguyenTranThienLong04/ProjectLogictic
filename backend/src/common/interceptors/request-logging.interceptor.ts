import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import type { RequestWithContext } from '../http/request-context.js';
import { structuredLog } from '../logging/structured-log.js';

@Injectable()
export class RequestLoggingInterceptor<T> implements NestInterceptor<T, T> {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<T> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const requestId = request.requestId ?? 'missing-request-id';
    const startedAt = performance.now();

    response.once('finish', () => {
      this.logger.log(
        structuredLog('http.request.completed', {
          requestId,
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
          userId: request.user?.id,
          role: request.user?.role,
        }),
      );
    });

    return next.handle();
  }
}
