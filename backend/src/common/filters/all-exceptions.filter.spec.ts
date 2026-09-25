import { HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { PricingConfigUnavailableException } from '../../modules/pricing/pricing-config-unavailable.exception.js';

function hostFor(responseBody: (body: unknown) => void) {
  const status = jest.fn(() => ({ json: responseBody }));
  return {
    host: {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          path: '/api/v1/test',
          requestId: 'req-error-test',
        }),
        getResponse: () => ({ status }),
      }),
    },
    status,
  };
}

describe('AllExceptionsFilter', () => {
  it('preserves the known missing-pricing condition at HTTP 503', () => {
    const json = jest.fn();
    const { host, status } = hostFor(json);
    new AllExceptionsFilter().catch(new PricingConfigUnavailableException(), host as never);
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      statusCode: 503,
      code: 'PRICING_CONFIG_UNAVAILABLE',
      message: 'Chưa có cấu hình giá vận chuyển đang hoạt động. Vui lòng liên hệ quản trị viên.',
      requestId: 'req-error-test',
    });
  });

  it('still redacts an arbitrary 503 even if it carries the pricing code', () => {
    const json = jest.fn();
    const { host, status } = hostFor(json);
    new AllExceptionsFilter().catch(
      new HttpException({ code: 'PRICING_CONFIG_UNAVAILABLE', message: 'database secret' }, 503),
      host as never,
    );
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      }),
    );
  });

  it('never exposes a message attached to an HTTP 5xx exception', () => {
    const json = jest.fn();
    const { host, status } = hostFor(json);

    new AllExceptionsFilter().catch(
      new InternalServerErrorException('database connection details'),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId: 'req-error-test',
    });
  });

  it('preserves safe validation details with a stable machine code', () => {
    const json = jest.fn();
    const { host } = hostFor(json);

    new AllExceptionsFilter().catch(
      new HttpException({ message: ['email must be an email'] }, HttpStatus.BAD_REQUEST),
      host as never,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: ['email must be an email'],
      requestId: 'req-error-test',
    });
  });
});
