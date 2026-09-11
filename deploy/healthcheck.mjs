try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/v1/health/ready`, { signal: AbortSignal.timeout(4000) });
  const { data } = await response.json();
  // Deployment readiness is stricter than the application's degraded-mode HTTP 200.
  if (!response.ok || data?.status !== 'ok' || data.checks.database !== 'up' || data.checks.redis !== 'up') process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
