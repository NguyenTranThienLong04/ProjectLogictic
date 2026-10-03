import { writeFile } from 'node:fs/promises';
import { resolveBuildMetadata } from '../dist/common/release/release-build.js';

const metadata = resolveBuildMetadata(process.env);
await writeFile(new URL('../dist/release-metadata.json', import.meta.url), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify({ event: 'release.artifact.created', ...metadata }));
if (metadata.commitSha === 'unknown') console.warn('Release SHA source unavailable; artifact records unknown');
