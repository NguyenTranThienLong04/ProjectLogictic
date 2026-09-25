import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executionMode, validateTarget, deletionOrder } from './reset-staging-data.mjs';

const env = {
  DATABASE_URL: 'postgresql://u:p@staging-pooler.example/db?sslmode=verify-full',
  DIRECT_URL: 'postgresql://u:p@staging.example/db?sslmode=verify-full',
  REDIS_URL: 'rediss://u:p@staging.redis.example:6379/0',
};
const target = { environment: 'staging', verifiedBy: 'operator', evidence: 'provider project and deployed bindings checked', database: 'staging.example:5432/db', redis: 'staging.redis.example:6379/0', redisDedicated: true, adminEmail: 'admin@example.test', apiBase: 'https://staging.example/api/v1' };
test('dry run default and both exact execution flags required', () => {
  assert.equal(executionMode({}), false);
  assert.equal(executionMode({ ALLOW_STAGING_RESET: 'true', RESET_CONFIRM: 'RESET_STAGING_KEEP_ADMIN' }), true);
  for (const value of [{ ALLOW_STAGING_RESET: 'true' }, { RESET_CONFIRM: 'RESET_STAGING_KEEP_ADMIN' }, { ALLOW_STAGING_RESET: 'false', RESET_CONFIRM: 'RESET_STAGING_KEEP_ADMIN' }]) assert.throws(() => executionMode(value));
});
test('reject production, unknown, shared Redis, missing evidence and mismatched endpoints', () => {
  validateTarget(env, target);
  for (const change of [{ environment: 'production' }, { environment: undefined }, { redisDedicated: false }, { evidence: '' }, { database: 'prod.example:5432/db' }, { redis: 'staging.redis.example:6379/1' }]) assert.throws(() => validateTarget(env, { ...target, ...change }));
  for (const change of [{ DATABASE_URL: 'postgresql://u:p@prod.example/db' }, { DIRECT_URL: 'postgresql://u:p@staging.example/db?sslmode=disable' }, { REDIS_URL: 'redis://localhost/0' }]) assert.throws(() => validateTarget({ ...env, ...change }, target));
  assert.throws(() => validateTarget(env, { ...target, adminEmail: undefined }, true));
  assert.throws(() => validateTarget(env, { ...target, keepAdminId: undefined }, true));
});
test('actual Prisma relations delete children before parents, excluding explicitly nulled route pointer', () => {
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const blocks = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const models = blocks.map(m => m[1]);
  const fks = blocks.flatMap(([, child, body]) => [...body.matchAll(/^\s+\w+\s+(\w+)\??\s+@relation\([^\n]*fields: \[(\w+)\]/gm)].map(([, parent, column]) => ({ child, parent, column })));
  assert.ok(fks.length > 40);
  const order = deletionOrder(models, fks);
  assert.equal(order.length, models.length);
  for (const f of fks) if (f.column !== 'currentRouteId') assert.ok(order.indexOf(f.child) < order.indexOf(f.parent), `${f.child} before ${f.parent}`);
  assert.ok(order.indexOf('AuthSession') < order.indexOf('User'));
  assert.ok(order.indexOf('DriverProfile') < order.indexOf('Warehouse'));
});
test('unexpected FK cycles fail closed', () => {
  assert.throws(() => deletionOrder(['a', 'b'], [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }]));
});
