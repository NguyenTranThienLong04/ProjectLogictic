import { validateEnvironment } from './env.validation.js';

describe('validateEnvironment', () => {
  const validEnvironment = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/logistics',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'a-secure-development-secret-with-32-chars',
  };

  it('applies safe local defaults', () => {
    const result = validateEnvironment(validEnvironment);

    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe('3000');
    expect(result.REDIS_URL).toBe('redis://localhost:6379');
    expect(result.ROUTE_PROVIDER).toBe('DISABLED');
    expect(result.ROUTE_TIMEOUT_MS).toBe('2500');
    expect(result.PAYMENT_PROVIDER).toBe('DISABLED');
    expect(result.LOCATIONIQ_API_KEY).toBe('');
  });

  it('trims the optional backend LocationIQ key', () => {
    expect(
      validateEnvironment({ ...validEnvironment, LOCATIONIQ_API_KEY: ' test-only-key ' })
        .LOCATIONIQ_API_KEY,
    ).toBe('test-only-key');
  });

  it('rejects invalid LocationIQ keys without echoing their contents', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, LOCATIONIQ_API_KEY: 'secret?unsafe=key' }),
    ).toThrow('LOCATIONIQ_API_KEY has an invalid format');
  });

  it('rejects a missing database URL', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: validEnvironment.NODE_ENV,
        FRONTEND_URL: validEnvironment.FRONTEND_URL,
        JWT_ACCESS_SECRET: validEnvironment.JWT_ACCESS_SECRET,
      }),
    ).toThrow('DATABASE_URL is required');
  });

  it('rejects an implicit runtime environment', () => {
    expect(() => validateEnvironment({ ...validEnvironment, NODE_ENV: undefined })).toThrow(
      'NODE_ENV is required',
    );
  });

  it('rejects an invalid port', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        PORT: '70000',
      }),
    ).toThrow('PORT must be an integer between 1 and 65535');
  });

  it('rejects a weak JWT access secret', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_ACCESS_SECRET: 'too-short',
      }),
    ).toThrow('JWT_ACCESS_SECRET must contain at least 32 characters');
  });

  it('uses secure production defaults and requires explicit production Redis', () => {
    const productionEnvironment = {
      ...validEnvironment,
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://logistics.example.test',
      REDIS_URL: 'rediss://cache.example.test:6379',
      JWT_ACCESS_SECRET: 'a-random-production-secret-that-is-at-least-32-characters',
    };

    const result = validateEnvironment(productionEnvironment);

    expect(result.REFRESH_COOKIE_NAME).toBe('__Secure-logistics_refresh');
    expect(result.SWAGGER_ENABLED).toBe('false');
    expect(() => validateEnvironment({ ...productionEnvironment, REDIS_URL: undefined })).toThrow(
      'REDIS_URL is required in production',
    );
  });

  it('rejects unsafe production URLs, cookie names, and placeholder secrets', () => {
    const productionEnvironment = {
      ...validEnvironment,
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://logistics.example.test',
      REDIS_URL: 'rediss://cache.example.test:6379',
      JWT_ACCESS_SECRET: 'a-random-production-secret-that-is-at-least-32-characters',
    };

    expect(() =>
      validateEnvironment({ ...productionEnvironment, FRONTEND_URL: 'http://logistics.test' }),
    ).toThrow('FRONTEND_URL must use HTTPS in production');
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        JWT_ACCESS_SECRET: 'replace-with-at-least-32-random-characters',
      }),
    ).toThrow('JWT_ACCESS_SECRET must not use an example or placeholder value in production');
    expect(() =>
      validateEnvironment({ ...productionEnvironment, REFRESH_COOKIE_NAME: 'logistics_refresh' }),
    ).toThrow('REFRESH_COOKIE_NAME must use the __Secure- prefix in production');
  });

  it('requires complete SMTP settings only when email delivery is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        EMAIL_DELIVERY_ENABLED: 'true',
      }),
    ).toThrow('SMTP_HOST is required');

    expect(
      validateEnvironment({
        ...validEnvironment,
        EMAIL_DELIVERY_ENABLED: 'true',
        EMAIL_FROM: 'Logistics <no-reply@example.test>',
        SMTP_HOST: 'smtp.example.test',
        SMTP_USER: 'smtp-user',
        SMTP_PASSWORD: 'smtp-password',
      }).EMAIL_DELIVERY_ENABLED,
    ).toBe('true');
  });

  it('allows an explicit development OSRM endpoint with bounded route settings', () => {
    const result = validateEnvironment({
      ...validEnvironment,
      ROUTE_PROVIDER: 'OSRM',
      ROUTE_PROVIDER_BASE_URL: 'http://localhost:5000',
      ROUTE_TIMEOUT_MS: '3000',
      ROUTE_BATCH_CONCURRENCY: '3',
    });

    expect(result.ROUTE_PROVIDER).toBe('OSRM');
    expect(result.ROUTE_PROVIDER_BASE_URL).toBe('http://localhost:5000/');
    expect(result.ROUTE_TIMEOUT_MS).toBe('3000');
    expect(result.ROUTE_BATCH_CONCURRENCY).toBe('3');
  });

  it('rejects unsafe route configuration and keeps production vendor-neutral', () => {
    expect(() => validateEnvironment({ ...validEnvironment, ROUTE_PROVIDER: 'UNKNOWN' })).toThrow(
      'ROUTE_PROVIDER must be DISABLED or OSRM',
    );
    expect(() => validateEnvironment({ ...validEnvironment, ROUTE_PROVIDER: 'OSRM' })).toThrow(
      'ROUTE_PROVIDER_BASE_URL is required',
    );
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        ROUTE_PROVIDER: 'OSRM',
        ROUTE_PROVIDER_BASE_URL: 'https://user:secret@router.example.test?token=secret',
      }),
    ).toThrow('ROUTE_PROVIDER_BASE_URL must not contain credentials');
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://logistics.example.test',
        REDIS_URL: 'rediss://cache.example.test:6379',
        JWT_ACCESS_SECRET: 'a-random-production-secret-that-is-at-least-32-characters',
        ROUTE_PROVIDER: 'OSRM',
        ROUTE_PROVIDER_BASE_URL: 'https://router.example.test',
      }),
    ).toThrow('ROUTE_PROVIDER must remain DISABLED in production');
  });

  it('allows only an explicit test payment adapter outside production', () => {
    const result = validateEnvironment({
      ...validEnvironment,
      PAYMENT_PROVIDER: 'TEST',
      PAYMENT_TEST_WEBHOOK_SECRET: 'phase-h3-environment-test-secret-32-characters',
    });
    expect(result.PAYMENT_PROVIDER).toBe('TEST');
    expect(result.PAYMENT_TIMEOUT_MS).toBe('5000');

    expect(() => validateEnvironment({ ...validEnvironment, PAYMENT_PROVIDER: 'TEST' })).toThrow(
      'PAYMENT_TEST_WEBHOOK_SECRET is required',
    );
    expect(() => validateEnvironment({ ...validEnvironment, PAYMENT_PROVIDER: 'VENDOR' })).toThrow(
      'PAYMENT_PROVIDER must be DISABLED or TEST',
    );
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://logistics.example.test',
        REDIS_URL: 'rediss://cache.example.test:6379',
        JWT_ACCESS_SECRET: 'a-random-production-secret-that-is-at-least-32-characters',
        PAYMENT_PROVIDER: 'TEST',
        PAYMENT_TEST_WEBHOOK_SECRET: 'phase-h3-environment-test-secret-32-characters',
      }),
    ).toThrow('PAYMENT_PROVIDER must remain DISABLED in production');
  });
});
