import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}\b/,
  /\bsk_live_[A-Za-z0-9]{20,}\b/,
  /postgres(?:ql)?:\/\/[^\s:]+:(?!PASSWORD@|password@|test@|postgres@|i1-local-disposable-only@)[^\s@]+@[^\s]*neon\.tech/i,
];
const findings = new Set();
const inspect = (path, content, context) => {
  if (patterns.some((pattern) => pattern.test(content))) findings.add(`${context}: ${path}`);
  if (/(^|\/)\.env(?:\.(?!example$)[^/]+)?$/.test(path)) findings.add(`${context}: tracked env file ${path}`);
};
const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
for (const path of new Set(files)) {
  if (path.startsWith('.agents/') || path.startsWith('.codex/')) continue;
  try { inspect(path, readFileSync(path, 'utf8'), 'workspace'); } catch { /* deleted file */ }
}
const revisions = git('rev-list', '--all').trim().split('\n').filter(Boolean);
for (const revision of revisions) {
  const paths = git('ls-tree', '-r', '--name-only', revision).trim().split('\n').filter(Boolean);
  for (const path of paths) {
    if (path.startsWith('.agents/') || path.startsWith('.codex/')) continue;
    inspect(path, git('show', `${revision}:${path}`), revision.slice(0, 8));
  }
}
console.log(`Heuristic scan: ${new Set(files).size} workspace paths; ${revisions.length} Git revisions; ${findings.size} findings.`);
for (const finding of findings) console.log(finding); // Never print matched credential values.
process.exitCode = findings.size ? 1 : 0;
