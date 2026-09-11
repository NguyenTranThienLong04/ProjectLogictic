import { access } from 'node:fs/promises';

const entrypoint = new URL('../dist/main.js', import.meta.url);

try {
  await access(entrypoint);
  console.log('Backend build artifact: dist/main.js');
} catch (cause) {
  throw new Error('Backend build did not emit dist/main.js', { cause });
}
