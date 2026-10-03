import { readFile } from 'node:fs/promises';
import { verifyReleasePair } from '../../backend/dist/common/release/release-build.js';

async function readArtifact(url, name) {
  try { return JSON.parse(await readFile(url, 'utf8')); }
  catch { throw new Error(`${name} release artifact unavailable or invalid`); }
}

const backend = await readArtifact(new URL('../../backend/dist/release-metadata.json', import.meta.url), 'Backend');
const frontend = await readArtifact(new URL('../../frontend/dist/release.json', import.meta.url), 'Frontend');
const pair = verifyReleasePair(backend, frontend, process.env);
console.log(JSON.stringify({ event: 'release.provenance.verified', ...pair }));
