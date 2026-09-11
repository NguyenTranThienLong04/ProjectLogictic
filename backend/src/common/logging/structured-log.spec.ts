import { structuredLog } from './structured-log.js';

describe('structuredLog', () => {
  it('redacts sensitive fields and credentials embedded in error strings', () => {
    const output = structuredLog('startup.failed', {
      password: 'plain-password',
      errorMessage:
        'connect postgresql://runtime-user:runtime-password@db.example.test/app Authorization=Bearer abc.def.ghi',
      nested: { refreshToken: 'opaque-token', safe: 'retained' },
    });

    expect(output).not.toContain('plain-password');
    expect(output).not.toContain('runtime-password');
    expect(output).not.toContain('abc.def.ghi');
    expect(output).not.toContain('opaque-token');
    expect(JSON.parse(output)).toMatchObject({
      event: 'startup.failed',
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', safe: 'retained' },
    });
  });
});
