import { jest } from '@jest/globals';
import { RequestContextMiddleware } from './request-context.middleware.js';

function invoke(requestId: string) {
  const request = { headers: { 'x-request-id': requestId } };
  const response = { setHeader: jest.fn() };
  const next = jest.fn();

  new RequestContextMiddleware().use(request as never, response as never, next);
  return { request, response, next };
}

describe('RequestContextMiddleware', () => {
  it('propagates a safe client request ID before guards execute', () => {
    const { request, response, next } = invoke('client-request-42');

    expect(request).toHaveProperty('requestId', 'client-request-42');
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', 'client-request-42');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces an unsafe request ID', () => {
    const { request, response } = invoke('bad\nlog-entry');

    expect(request).toHaveProperty('requestId', expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(response.setHeader).not.toHaveBeenCalledWith('X-Request-Id', 'bad\nlog-entry');
  });
});
