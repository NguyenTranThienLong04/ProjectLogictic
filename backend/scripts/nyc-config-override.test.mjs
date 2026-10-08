import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { loadNycConfig } = require('@istanbuljs/load-nyc-config');

test('NYC scoped YAML override preserves config loading, extends and value types', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'nyc-override-'));
  try {
    await writeFile(join(cwd, 'package.json'), '{"private":true}');
    await writeFile(
      join(cwd, 'base.yml'),
      'all: true\ninclude:\n  - backend/src/**/*.ts\nlines: 80\n',
    );
    await writeFile(
      join(cwd, '.nycrc.yml'),
      'extends: ./base.yml\ncheck-coverage: true\nsource-map: false\nexclude: "**/*.spec.ts"\nreporter: [text, lcov]\nlines: 85\n',
    );
    const config = await loadNycConfig({ cwd });
    assert.deepEqual(config, {
      cwd,
      all: true,
      include: ['backend/src/**/*.ts'],
      // NYC 1.1.0 applies extended config last; preserve that existing contract.
      lines: 80,
      checkCoverage: true,
      sourceMap: false,
      exclude: ['**/*.spec.ts'],
      reporter: ['text', 'lcov'],
    });
    await writeFile(join(cwd, '.nycrc.yml'), 'include: [invalid\n');
    await assert.rejects(loadNycConfig({ cwd }), { name: 'YAMLException' });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
