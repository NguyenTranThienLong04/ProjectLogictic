import { resolveBuildMetadata, verifyReleasePair } from '../../backend/src/common/release/release-build.ts';

try {
  const release = resolveBuildMetadata(process.env);
  verifyReleasePair(release, release, process.env);
  process.stdout.write(release.commitSha === 'unknown' ? '' : release.commitSha);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Release source validation failed');
  process.exitCode = 1;
}
