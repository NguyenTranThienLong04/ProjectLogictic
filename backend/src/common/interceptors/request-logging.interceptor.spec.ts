import { Logger, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { jest } from '@jest/globals';
import { firstValueFrom, of } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor.js';

function createContext(requestId: string) {
  let finishListener: (() => void) | undefined;
  const request = {
    requestId,
    method: 'GET',
    path: '/api/v1/shipments',
    user: { id: 'user-1', role: 'CUSTOMER' },
  };
  const response = {
    statusCode: 200,
    once: jest.fn((event: string, listener: () => void) => {
      if (event === 'finish') finishListener = listener;
      return response;
    }),
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ExecutionContext;

  return { context, request, response, finish: () => finishListener?.() };
}

describe('RequestLoggingInterceptor', () => {
  const next: CallHandler<string> = { handle: () => of('ok') };

  afterEach(() => jest.restoreAllMocks());

  it('propagates a safe request ID and writes a structured completion log', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { context, request, finish } = createContext('client-request-42');

    await firstValueFrom(new RequestLoggingInterceptor().intercept(context, next));
    finish();

    expect(request).toHaveProperty('requestId', 'client-request-42');
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: 'http.request.completed',
      requestId: 'client-request-42',
      method: 'GET',
      path: '/api/v1/shipments',
      statusCode: 200,
      userId: 'user-1',
      role: 'CUSTOMER',
    });
  });
});
