import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { TrustedOriginGuard } from './trusted-origin.guard.js';

function context(origin?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: origin ? { origin } : {} }),
    }),
  } as ExecutionContext;
}

function config(nodeEnvironment: string): ConfigService {
  return {
    getOrThrow: jest.fn((key: string) =>
      key === 'NODE_ENV' ? nodeEnvironment : 'https://logistics.example.test',
    ),
  } as unknown as ConfigService;
}

describe('TrustedOriginGuard', () => {
  it('rejects a browser origin outside the configured production frontend', () => {
    const guard = new TrustedOriginGuard(config('production'));

    expect(() => guard.canActivate(context('https://attacker.example'))).toThrow(
      ForbiddenException,
    );
  });

  it('allows the configured origin and non-browser requests without an Origin header', () => {
    const guard = new TrustedOriginGuard(config('production'));

    expect(guard.canActivate(context('https://logistics.example.test'))).toBe(true);
    expect(guard.canActivate(context())).toBe(true);
  });

  it('does not constrain local development tools', () => {
    const guard = new TrustedOriginGuard(config('development'));
    expect(guard.canActivate(context('http://localhost:3000'))).toBe(true);
  });
});
