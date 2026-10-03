export interface ReleaseBuildMetadata {
  readonly commitSha: string;
  readonly buildTimestamp: string;
}

const FULL_COMMIT_SHA = /^(?:[a-f\d]{40}|[a-f\d]{64})$/i;
const SHA_SOURCES = ['RELEASE_SHA', 'RENDER_GIT_COMMIT', 'GITHUB_SHA'] as const;

function isBuildTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function resolveBuildMetadata(
  environment: Record<string, string | undefined>,
  buildTime = new Date(),
): Readonly<ReleaseBuildMetadata> {
  const sources = SHA_SOURCES.flatMap((key) => {
    const value = environment[key]?.trim();
    if (!value) return [];
    if (!FULL_COMMIT_SHA.test(value)) {
      throw new Error(`${key} must contain a full commit SHA`);
    }
    return [{ key, value: value.toLowerCase() }];
  });
  if (new Set(sources.map(({ value }) => value)).size > 1) {
    throw new Error('Release SHA sources disagree');
  }
  const buildTimestamp = environment.RELEASE_BUILD_TIMESTAMP?.trim() || buildTime.toISOString();
  if (!isBuildTimestamp(buildTimestamp)) {
    throw new Error('RELEASE_BUILD_TIMESTAMP must contain an ISO UTC timestamp');
  }
  return Object.freeze({ commitSha: sources[0]?.value ?? 'unknown', buildTimestamp });
}

export function projectBuildMetadata(value: unknown): Readonly<ReleaseBuildMetadata> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Release provenance artifact is invalid');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.commitSha !== 'string' ||
    (record.commitSha !== 'unknown' && !FULL_COMMIT_SHA.test(record.commitSha)) ||
    (record.buildTimestamp !== 'unknown' && !isBuildTimestamp(record.buildTimestamp))
  ) {
    throw new Error('Release provenance artifact is invalid');
  }
  return Object.freeze({
    commitSha: record.commitSha.toLowerCase(),
    buildTimestamp: record.buildTimestamp,
  });
}

export function verifyReleasePair(
  backendValue: unknown,
  frontendValue: unknown,
  environment: Record<string, string | undefined>,
): { backend: Readonly<ReleaseBuildMetadata>; frontend: Readonly<ReleaseBuildMetadata> } {
  const backend = projectBuildMetadata(backendValue);
  const frontend = projectBuildMetadata(frontendValue);
  const expected = resolveBuildMetadata(environment);
  if (environment.CI === 'true' && expected.commitSha === 'unknown') {
    throw new Error('CI release verification requires a supplied commit SHA');
  }
  if (backend.commitSha !== frontend.commitSha) {
    throw new Error('Backend and frontend release SHAs disagree');
  }
  if (expected.commitSha !== 'unknown' && backend.commitSha !== expected.commitSha) {
    throw new Error('Built release SHA does not match supplied source SHA');
  }
  if (backend.buildTimestamp === 'unknown' || frontend.buildTimestamp === 'unknown') {
    throw new Error('Built release artifacts require build timestamps');
  }
  return { backend, frontend };
}
