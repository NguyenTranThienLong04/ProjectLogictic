import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from '../http/request-context.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const suppliedRequestId = request.headers['x-request-id'];
    const candidate = Array.isArray(suppliedRequestId) ? suppliedRequestId[0] : suppliedRequestId;
    const requestId = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  }
}
