import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { RequestWithContext } from '../http/request-context.js';
import { structuredLog } from '../logging/structured-log.js';

interface ErrorResponse {
  statusCode?: number;
  code?: string;
  message?: string | string[];
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithContext>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const internalServerErrorStatus: number = HttpStatus.INTERNAL_SERVER_ERROR;
    const isServerError = status >= internalServerErrorStatus;
    const details = isServerError ? {} : this.normalizeResponse(exceptionResponse);

    if (isServerError) {
      this.logger.error(
        structuredLog('http.request.failed', {
          requestId: request.requestId,
          method: request.method,
          path: request.path,
          statusCode: status,
          errorName: exception instanceof Error ? exception.name : 'UnknownError',
          errorMessage: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      );
    }

    response.status(status).json({
      statusCode: status,
      code: isServerError ? 'INTERNAL_SERVER_ERROR' : (details.code ?? this.defaultCode(status)),
      message: isServerError ? 'Internal server error' : (details.message ?? 'Request failed'),
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });
  }

  private normalizeResponse(response: string | object | undefined): ErrorResponse {
    if (typeof response === 'string') {
      return { message: response };
    }

    if (response && typeof response === 'object') {
      return response;
    }

    return {};
  }

  private defaultCode(status: number): string {
    const defaultCodes: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
      [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT_EXCEEDED',
    };
    return defaultCodes[status] ?? `HTTP_${status}`;
  }
}
