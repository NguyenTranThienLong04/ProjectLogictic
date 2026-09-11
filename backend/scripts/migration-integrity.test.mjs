import assert from 'node:assert/strict';
import test from 'node:test';
import { checkHistory, compareBaseline, sha256 } from './migration-integrity.mjs';

const baseline = { lock: 'postgres', migrations: { '001': sha256('sql\n'), '002': sha256('next') } };
const row = (name) => ({ migration_name: name, checksum: baseline.migrations[name], finished_at: new Date(), rolled_back_at: null });
test('committed migrations cannot be edited, deleted or inserted before the tail', () => {
  assert.throws(() => compareBaseline({ ...baseline, migrations: { ...baseline.migrations, '001': sha256('sql\r\n') } }, baseline));
  assert.throws(() => compareBaseline({ ...baseline, migrations: { '001': baseline.migrations['001'] } }, baseline));
  assert.throws(() => compareBaseline({ ...baseline, migrations: { ...baseline.migrations, '000': 'new' } }, baseline));
  compareBaseline({ ...baseline, migrations: { ...baseline.migrations, '003': 'new' } }, baseline);
});
test('history fails closed for checksum mismatch, unresolved, unknown, duplicate, missing and gaps', () => {
  assert.equal(checkHistory(baseline, [row('001'), row('002')]), 2);
  assert.equal(checkHistory(baseline, [row('001')], true), 1);
  for (const rows of [
    [{ ...row('001'), checksum: 'changed' }], [{ ...row('001'), finished_at: null }],
    [row('unknown')], [row('001'), row('001')], [row('002')],
  ]) assert.throws(() => checkHistory(baseline, rows, true));
  assert.throws(() => checkHistory(baseline, [row('001')]));
  assert.equal(checkHistory(baseline, [{ ...row('001'), finished_at: null, rolled_back_at: new Date() }, row('001'), row('002')]), 2);
});
