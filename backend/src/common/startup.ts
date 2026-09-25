// Bound pre-listen hooks even when a socket connects but never answers.
export async function startupStep<T>(
  dependency: string,
  operation: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('STARTUP_TIMEOUT')), timeoutMs);
      }),
    ]);
  } catch (error) {
    const code =
      error instanceof Error && error.message === 'STARTUP_TIMEOUT'
        ? 'timeout'
        : 'connection or readiness failed';
    // Keep the cause internally; only this safe top-level message reaches startup logs.
    throw new Error(`${dependency} startup ${code}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
