import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ApiResponseInterceptor } from './api-response.interceptor.js';

describe('ApiResponseInterceptor', () => {
  it('wraps successful payloads in the API envelope', async () => {
    const interceptor = new ApiResponseInterceptor<{ ok: boolean }>();
    const next: CallHandler<{ ok: boolean }> = {
      handle: () => of({ ok: true }),
    };

    const context = {
      switchToHttp: () => ({ getRequest: () => ({ requestId: 'req-api-response' }) }),
    } as ExecutionContext;
    const response = await firstValueFrom(interceptor.intercept(context, next));

    expect(response).toEqual({ data: { ok: true }, meta: { requestId: 'req-api-response' } });
  });
});
