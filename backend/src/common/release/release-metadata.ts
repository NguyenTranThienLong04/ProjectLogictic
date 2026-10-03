import { readFileSync } from 'node:fs';
import { projectBuildMetadata, type ReleaseBuildMetadata } from './release-build.js';

export interface RuntimeReleaseMetadata extends ReleaseBuildMetadata {
  readonly runtimeNodeVersion: string;
}

export function readReleaseMetadata(
  artifact = new URL('../../release-metadata.json', import.meta.url),
): Readonly<RuntimeReleaseMetadata> {
  let content: string;
  try {
    content = readFileSync(artifact, 'utf8');
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return Object.freeze({
        commitSha: 'unknown',
        buildTimestamp: 'unknown',
        runtimeNodeVersion: process.version,
      });
    }
    throw new Error('Release provenance artifact could not be read', { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error('Release provenance artifact is invalid');
  }
  return Object.freeze({ ...projectBuildMetadata(parsed), runtimeNodeVersion: process.version });
}

let cachedMetadata: Readonly<RuntimeReleaseMetadata> | undefined;

export function getReleaseMetadata(): Readonly<RuntimeReleaseMetadata> {
  cachedMetadata ??= readReleaseMetadata();
  return cachedMetadata;
}
