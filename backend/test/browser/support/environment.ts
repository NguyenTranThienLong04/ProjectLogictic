import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const repositoryRoot = resolve(import.meta.dirname, '../../../..');

let loaded = false;

export function loadRootEnvironment(): void {
  if (loaded) return;
  const path = resolve(repositoryRoot, '.env');
  // Clean CI checkouts supply their environment directly and have no secret file.
  const contents = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
  loaded = true;
}

export function requiredEnvironment(name: string): string {
  loadRootEnvironment();
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for browser E2E`);
  return value;
}
