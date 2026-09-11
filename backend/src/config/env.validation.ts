type Environment = Record<string, string | undefined>;

const allowedNodeEnvironments = new Set(['development', 'test', 'production']);
const allowedCookieSameSiteValues = new Set(['lax', 'strict', 'none']);
const allowedRouteProviders = new Set(['DISABLED', 'OSRM']);
const allowedPaymentProviders = new Set(['DISABLED', 'TEST']);
const COOKIE_NAME = /^(?:__Secure-)?[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const INSECURE_SECRET_MARKERS = ['replace-with', 'change-me', 'changeme', 'example-secret'];

function requiredUrl(
  environment: Environment,
  name: string,
  allowedProtocols: ReadonlySet<string>,
): string {
  const value = environment[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  try {
    const url = new URL(value);
    if (!allowedProtocols.has(url.protocol)) {
      throw new Error('unsupported protocol');
    }
    return url.toString();
  } catch {
    throw new Error(`${name} must be a valid ${[...allowedProtocols].join(' or ')} URL`);
  }
}

function positiveInteger(
  environment: Environment,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): string {
  const value = Number(environment[name] ?? fallback);

  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }

  return String(value);
}

function nonNegativeInteger(
  environment: Environment,
  name: string,
  fallback: number,
  maximum: number,
): string {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 0 and ${maximum}`);
  }
  return String(value);
}

function booleanString(environment: Environment, name: string, fallback: boolean): string {
  const value = environment[name] ?? String(fallback);
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
  return value;
}

function requiredString(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function frontendOrigin(environment: Environment): string {
  const value = requiredUrl(environment, 'FRONTEND_URL', new Set(['http:', 'https:']));
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('FRONTEND_URL must be an origin without credentials, path, query, or hash');
  }
  return url.origin;
}

export function validateEnvironment(environment: Environment): Environment {
  const nodeEnvironment = requiredString(environment, 'NODE_ENV');

  if (!allowedNodeEnvironments.has(nodeEnvironment)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const port = Number(environment.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const jwtAccessSecret = environment.JWT_ACCESS_SECRET;
  if (!jwtAccessSecret || jwtAccessSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters');
  }
  if (
    nodeEnvironment === 'production' &&
    INSECURE_SECRET_MARKERS.some((marker) => jwtAccessSecret.toLowerCase().includes(marker))
  ) {
    throw new Error('JWT_ACCESS_SECRET must not use an example or placeholder value in production');
  }

  const frontendUrl = frontendOrigin(environment);
  if (nodeEnvironment === 'production' && !frontendUrl.startsWith('https://')) {
    throw new Error('FRONTEND_URL must use HTTPS in production');
  }

  const redisUrl = environment.REDIS_URL
    ? requiredUrl(environment, 'REDIS_URL', new Set(['redis:', 'rediss:']))
    : nodeEnvironment === 'production'
      ? (() => {
          throw new Error('REDIS_URL is required in production');
        })()
      : 'redis://localhost:6379';

  const routeProvider = (environment.ROUTE_PROVIDER ?? 'DISABLED').trim().toUpperCase();
  if (!allowedRouteProviders.has(routeProvider)) {
    throw new Error('ROUTE_PROVIDER must be DISABLED or OSRM');
  }
  if (nodeEnvironment === 'production' && routeProvider !== 'DISABLED') {
    throw new Error(
      'ROUTE_PROVIDER must remain DISABLED in production until a canonical provider is approved',
    );
  }
  let routeProviderBaseUrl = '';
  if (routeProvider === 'OSRM') {
    routeProviderBaseUrl = requiredUrl(
      environment,
      'ROUTE_PROVIDER_BASE_URL',
      new Set(['http:', 'https:']),
    );
    const parsedRouteUrl = new URL(routeProviderBaseUrl);
    if (
      parsedRouteUrl.username ||
      parsedRouteUrl.password ||
      parsedRouteUrl.search ||
      parsedRouteUrl.hash
    ) {
      throw new Error(
        'ROUTE_PROVIDER_BASE_URL must not contain credentials, query parameters, or a fragment',
      );
    }
  }

  const paymentProvider = (environment.PAYMENT_PROVIDER ?? 'DISABLED').trim().toUpperCase();
  if (!allowedPaymentProviders.has(paymentProvider)) {
    throw new Error('PAYMENT_PROVIDER must be DISABLED or TEST');
  }
  if (nodeEnvironment === 'production' && paymentProvider !== 'DISABLED') {
    throw new Error(
      'PAYMENT_PROVIDER must remain DISABLED in production until a canonical provider is approved',
    );
  }
  const paymentTestWebhookSecret =
    paymentProvider === 'TEST'
      ? requiredString(environment, 'PAYMENT_TEST_WEBHOOK_SECRET')
      : (environment.PAYMENT_TEST_WEBHOOK_SECRET?.trim() ?? '');
  if (paymentProvider === 'TEST' && paymentTestWebhookSecret.length < 32) {
    throw new Error('PAYMENT_TEST_WEBHOOK_SECRET must contain at least 32 characters');
  }

  const refreshCookieName =
    environment.REFRESH_COOKIE_NAME ??
    (nodeEnvironment === 'production' ? '__Secure-logistics_refresh' : 'logistics_refresh');
  if (!COOKIE_NAME.test(refreshCookieName)) {
    throw new Error('REFRESH_COOKIE_NAME contains invalid cookie-name characters');
  }
  if (nodeEnvironment === 'production' && !refreshCookieName.startsWith('__Secure-')) {
    throw new Error('REFRESH_COOKIE_NAME must use the __Secure- prefix in production');
  }
  const refreshCookieSameSite = environment.REFRESH_COOKIE_SAME_SITE ?? 'lax';
  if (!allowedCookieSameSiteValues.has(refreshCookieSameSite)) {
    throw new Error('REFRESH_COOKIE_SAME_SITE must be lax, strict, or none');
  }

  const emailDeliveryEnabled = booleanString(environment, 'EMAIL_DELIVERY_ENABLED', false);
  const smtpSecure = booleanString(environment, 'SMTP_SECURE', false);
  const smtpPort = positiveInteger(environment, 'SMTP_PORT', 587, 65_535);
  const emailConfiguration =
    emailDeliveryEnabled === 'true'
      ? {
          SMTP_HOST: requiredString(environment, 'SMTP_HOST'),
          SMTP_USER: requiredString(environment, 'SMTP_USER'),
          SMTP_PASSWORD: requiredString(environment, 'SMTP_PASSWORD'),
          EMAIL_FROM: requiredString(environment, 'EMAIL_FROM'),
        }
      : {
          SMTP_HOST: environment.SMTP_HOST ?? '',
          SMTP_USER: environment.SMTP_USER ?? '',
          SMTP_PASSWORD: environment.SMTP_PASSWORD ?? '',
          EMAIL_FROM: environment.EMAIL_FROM ?? 'Logistics Operations <no-reply@logistics.local>',
        };
  if (
    emailConfiguration.EMAIL_FROM.includes('\r') ||
    emailConfiguration.EMAIL_FROM.includes('\n')
  ) {
    throw new Error('EMAIL_FROM must not contain line breaks');
  }

  const passwordResetUrl = environment.PASSWORD_RESET_URL
    ? requiredUrl(environment, 'PASSWORD_RESET_URL', new Set(['http:', 'https:']))
    : `${frontendUrl}/reset-password`;
  if (nodeEnvironment === 'production' && !passwordResetUrl.startsWith('https://')) {
    throw new Error('PASSWORD_RESET_URL must use HTTPS in production');
  }

  return {
    ...environment,
    NODE_ENV: nodeEnvironment,
    PORT: String(port),
    DATABASE_URL: requiredUrl(environment, 'DATABASE_URL', new Set(['postgres:', 'postgresql:'])),
    REDIS_URL: redisUrl,
    FRONTEND_URL: frontendUrl,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_ISSUER: environment.JWT_ISSUER?.trim() || 'logistics-api',
    JWT_AUDIENCE: environment.JWT_AUDIENCE?.trim() || 'logistics-web',
    ACCESS_TOKEN_TTL_SECONDS: positiveInteger(environment, 'ACCESS_TOKEN_TTL_SECONDS', 900),
    REFRESH_TOKEN_TTL_DAYS: positiveInteger(environment, 'REFRESH_TOKEN_TTL_DAYS', 30),
    PASSWORD_RESET_TTL_MINUTES: positiveInteger(environment, 'PASSWORD_RESET_TTL_MINUTES', 15),
    CACHE_TRACKING_TTL_SECONDS: positiveInteger(environment, 'CACHE_TRACKING_TTL_SECONDS', 60),
    CACHE_SHIPMENT_TTL_SECONDS: positiveInteger(environment, 'CACHE_SHIPMENT_TTL_SECONDS', 60),
    ROUTE_PROVIDER: routeProvider,
    ROUTE_PROVIDER_BASE_URL: routeProviderBaseUrl,
    ROUTE_TIMEOUT_MS: positiveInteger(environment, 'ROUTE_TIMEOUT_MS', 2_500, 5_000),
    ROUTE_CACHE_TTL_SECONDS: positiveInteger(environment, 'ROUTE_CACHE_TTL_SECONDS', 900, 86_400),
    ROUTE_GEOMETRY_MAX_POINTS: positiveInteger(
      environment,
      'ROUTE_GEOMETRY_MAX_POINTS',
      2_000,
      2_000,
    ),
    ROUTE_BATCH_CONCURRENCY: positiveInteger(environment, 'ROUTE_BATCH_CONCURRENCY', 4, 10),
    ROUTE_BATCH_EXTERNAL_CALL_LIMIT: positiveInteger(
      environment,
      'ROUTE_BATCH_EXTERNAL_CALL_LIMIT',
      20,
      50,
    ),
    PAYMENT_PROVIDER: paymentProvider,
    PAYMENT_TEST_WEBHOOK_SECRET: paymentTestWebhookSecret,
    PAYMENT_TIMEOUT_MS: positiveInteger(environment, 'PAYMENT_TIMEOUT_MS', 5_000, 15_000),
    LINE_HAUL_ROUTE_DEVIATION_METERS: positiveInteger(
      environment,
      'LINE_HAUL_ROUTE_DEVIATION_METERS',
      500,
      10_000,
    ),
    LINE_HAUL_ROUTE_DEVIATION_CONSECUTIVE_SAMPLES: positiveInteger(
      environment,
      'LINE_HAUL_ROUTE_DEVIATION_CONSECUTIVE_SAMPLES',
      3,
      10,
    ),
    EMAIL_DELIVERY_ENABLED: emailDeliveryEnabled,
    SMTP_PORT: smtpPort,
    SMTP_SECURE: smtpSecure,
    SMTP_CONNECTION_TIMEOUT_MS: positiveInteger(environment, 'SMTP_CONNECTION_TIMEOUT_MS', 10_000),
    SMTP_GREETING_TIMEOUT_MS: positiveInteger(environment, 'SMTP_GREETING_TIMEOUT_MS', 10_000),
    SMTP_SOCKET_TIMEOUT_MS: positiveInteger(environment, 'SMTP_SOCKET_TIMEOUT_MS', 30_000),
    ...emailConfiguration,
    PASSWORD_RESET_URL: passwordResetUrl,
    REFRESH_COOKIE_NAME: refreshCookieName,
    REFRESH_COOKIE_SAME_SITE: refreshCookieSameSite,
    TRUST_PROXY_HOPS: nonNegativeInteger(environment, 'TRUST_PROXY_HOPS', 0, 10),
    SWAGGER_ENABLED: booleanString(
      environment,
      'SWAGGER_ENABLED',
      nodeEnvironment !== 'production',
    ),
  };
}
