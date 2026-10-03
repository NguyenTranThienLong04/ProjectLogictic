import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readReleaseMetadata } from './release-metadata.js';

const commitSha = 'a'.repeat(40);
const buildTimestamp = '2026-10-03T01:00:00.000Z';

describe('Runtime release metadata', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'logistics-release-'));
  });
  afterEach(() => {
    expect(directory.startsWith(join(tmpdir(), 'logistics-release-'))).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  });

  function artifact(content: string): URL {
    const file = join(directory, 'release-metadata.json');
    writeFileSync(file, content);
    return pathToFileURL(file);
  }

  it('reads the immutable artifact and projects only public fields', () => {
    const result = readReleaseMetadata(
      artifact(
        JSON.stringify({
          commitSha,
          buildTimestamp,
          secret: 'never-return-this',
          runtimeNodeVersion: 'forged',
        }),
      ),
    );
    expect(result).toEqual({ commitSha, buildTimestamp, runtimeNodeVersion: process.version });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('cannot replace the built identity with runtime environment values', () => {
    const previous = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = 'b'.repeat(40);
    try {
      expect(
        readReleaseMetadata(artifact(JSON.stringify({ commitSha, buildTimestamp }))).commitSha,
      ).toBe(commitSha);
    } finally {
      if (previous === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = previous;
    }
  });

  it('reports unknown build metadata for an unbuilt development entrypoint', () => {
    expect(readReleaseMetadata(pathToFileURL(join(directory, 'missing.json')))).toEqual({
      commitSha: 'unknown',
      buildTimestamp: 'unknown',
      runtimeNodeVersion: process.version,
    });
  });

  it.each([
    '{secret-invalid-json',
    JSON.stringify({ commitSha: 'secret-invalid-sha', buildTimestamp }),
    JSON.stringify({ commitSha, buildTimestamp: 'secret-invalid-timestamp' }),
    JSON.stringify({ commitSha }),
  ])('fails safely for a corrupt artifact without exposing its contents', (content) => {
    expect(() => readReleaseMetadata(artifact(content))).toThrow(
      'Release provenance artifact is invalid',
    );
  });
});
