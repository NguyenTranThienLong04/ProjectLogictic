import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  projectBuildMetadata,
  resolveBuildMetadata,
  verifyReleasePair,
} from '../backend/src/common/release/release-build.ts';

const commitSha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const buildTimestamp = '2026-10-03T01:00:00.000Z';
const metadata = { commitSha, buildTimestamp };

for (const key of ['RELEASE_SHA', 'RENDER_GIT_COMMIT', 'GITHUB_SHA']) {
  test(`build uses the supplied ${key} and records build time`, () => {
    assert.deepEqual(resolveBuildMetadata({ [key]: commitSha }, new Date(buildTimestamp)), metadata);
  });
}

test('absent identity source is unknown and never inferred from Git', () => {
  assert.deepEqual(resolveBuildMetadata({}, new Date(buildTimestamp)), { commitSha: 'unknown', buildTimestamp });
});

test('matching platform and explicit identities normalize full SHAs', () => {
  assert.deepEqual(resolveBuildMetadata({ RELEASE_SHA: commitSha.toUpperCase(), RENDER_GIT_COMMIT: commitSha, GITHUB_SHA: commitSha, RELEASE_BUILD_TIMESTAMP: buildTimestamp }), metadata);
});

test('conflicting supplied identities fail clearly', () => {
  assert.throws(() => resolveBuildMetadata({ RELEASE_SHA: commitSha, GITHUB_SHA: otherSha }), /SHA sources disagree/);
});

test('invalid identity and timestamp errors do not echo supplied contents', () => {
  for (const environment of [{ RELEASE_SHA: 'secret-value\nforged-log' }, { RELEASE_BUILD_TIMESTAMP: 'secret-value' }]) {
    assert.throws(() => resolveBuildMetadata(environment), (error) => !error.message.includes('secret-value'));
  }
});

test('public metadata projection removes non-allowlisted fields', () => {
  assert.deepEqual(projectBuildMetadata({ ...metadata, secret: 'secret-value', DATABASE_URL: 'secret-url' }), metadata);
});

test('pair verification passes the exact supplied CI identity', () => {
  assert.deepEqual(verifyReleasePair(metadata, metadata, { CI: 'true', GITHUB_SHA: commitSha }), { backend: metadata, frontend: metadata });
});

test('separate build timestamps remain visible independently for a matching SHA', () => {
  const frontend = { ...metadata, buildTimestamp: '2026-10-03T01:01:00.000Z' };
  assert.deepEqual(verifyReleasePair(metadata, frontend, { GITHUB_SHA: commitSha }).frontend, frontend);
});

test('pair verification rejects mismatched deployments and incorrect source identity', () => {
  assert.throws(() => verifyReleasePair(metadata, { ...metadata, commitSha: otherSha }, {}), /SHAs disagree/);
  assert.throws(() => verifyReleasePair(metadata, metadata, { GITHUB_SHA: otherSha }), /does not match/);
});

test('CI verification rejects unknown identity and missing build timestamps', () => {
  assert.throws(() => verifyReleasePair({ ...metadata, commitSha: 'unknown' }, { ...metadata, commitSha: 'unknown' }, { CI: 'true' }), /supplied commit SHA/);
  assert.throws(() => verifyReleasePair({ ...metadata, buildTimestamp: 'unknown' }, metadata, {}), /build timestamps/);
});

test('container source command resolves matching source identities before tag selection', () => {
  const result = runContainerSourceGuard({ RELEASE_SHA: commitSha.toUpperCase(), GITHUB_SHA: commitSha });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, commitSha);
});

test('container source command fails closed for conflicting or missing CI identity', () => {
  for (const environment of [{ RELEASE_SHA: otherSha, GITHUB_SHA: commitSha }, {}]) {
    const result = runContainerSourceGuard(environment);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /SHA sources disagree|requires a supplied commit SHA/);
  }
});

test('container source command rejects invalid identity without printing the value', () => {
  const result = runContainerSourceGuard({ RENDER_GIT_COMMIT: 'secret-value-forged-log' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(!result.stderr.includes('secret-value-forged-log'));
});

function runContainerSourceGuard(environment) {
  return spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./ci/resolve-release-source.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: { ...process.env, RELEASE_SHA: '', GITHUB_SHA: '', RENDER_GIT_COMMIT: '', RELEASE_BUILD_TIMESTAMP: '', CI: 'true', ...environment },
    timeout: 5000,
  });
}
