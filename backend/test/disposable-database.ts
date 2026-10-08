// Fixture writes are restricted to the local regression runner or explicit CI test databases.
export function assertDisposablePostgresDatabase(environment: {
  DATABASE_URL?: string;
  CI?: string;
}): void {
  const message =
    'E2E requires PostgreSQL on localhost:55432 with p0_regression_<timestamp>, or CI=true with i1_(e2e|browser|smoke)[_<timestamp>]; connection overrides are not allowed';
  if (!environment.DATABASE_URL || !URL.canParse(environment.DATABASE_URL)) {
    throw new Error(message);
  }
  const url = new URL(environment.DATABASE_URL);
  const disposableName =
    /^\/p0_regression_\d+$/.test(url.pathname) ||
    (environment.CI === 'true' && /^\/i1_(e2e|browser|smoke)(?:_\d+)?$/.test(url.pathname));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '55432' ||
    url.search !== '' ||
    url.hash !== '' ||
    !disposableName
  ) {
    throw new Error(message);
  }
}
