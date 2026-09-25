// Run after backend build. Only SELECT over CTE fixtures; no application data read/written.
import assert from 'node:assert/strict';
import pg from 'pg';
import { Prisma } from '../dist/generated/prisma/client.js';
import { warehouseListWhere } from '../dist/modules/warehouses/warehouse-list-query.js';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
await db.connect();
const fixture = Prisma.sql`WITH "Warehouse"("id", "code", "name", "address", "ward", "district", "city", "isActive") AS (VALUES
  ('a', 'WH-01', 'Kho Đầu Mối', '123 Nguyễn Trãi', 'Bến Thành', '', 'Hồ Chí Minh', true),
  ('b', 'WH-02', 'Kho Phụ', '10 Trần Phú', 'Chợ Quán', '', 'Hồ Chí Minh', false),
  ('c', 'WH-03', 'Kho Bắc', '45 Đội Cấn', 'Ba Đình', '', 'Hà Nội', true)
)`;
try {
  const cases = [
    [{ search: 'wh-01' }, ['a']],
    [{ search: 'dau moi' }, ['a']],
    [{ search: 'Đầu Mối' }, ['a']],
    [{ search: 'nguyen trai' }, ['a']],
    [{ search: 'Nguyễn Trãi'.normalize('NFD') }, ['a']],
    [{ search: 'DOI CAN' }, ['c']],
    [{ search: "%' OR TRUE --" }, []],
    [{ city: 'Hồ Chí Minh', ward: 'Chợ Quán', isActive: false }, ['b']],
    [{ city: 'Hà Nội', ward: 'Chợ Quán' }, []],
    [{ city: 'Hồ Chí Minh', isActive: true, search: 'nguyen' }, ['a']],
    [{}, ['a', 'c', 'b']],
  ];
  for (const [filters, expected] of cases) {
    const where = warehouseListWhere(filters);
    const sql = Prisma.sql`${fixture} SELECT "id" FROM "Warehouse" WHERE ${where} ORDER BY "isActive" DESC, "code" ASC`;
    const result = await db.query(sql.text, sql.values);
    assert.deepEqual(result.rows.map((row) => row.id), expected);
    const count = Prisma.sql`${fixture} SELECT count(*) AS total FROM "Warehouse" WHERE ${where}`;
    assert.equal(Number((await db.query(count.text, count.values)).rows[0].total), expected.length);
  }
  const paginated = Prisma.sql`${fixture} SELECT "id" FROM "Warehouse" WHERE ${warehouseListWhere({})} ORDER BY "isActive" DESC, "code" ASC LIMIT ${1} OFFSET ${1}`;
  assert.deepEqual((await db.query(paginated.text, paginated.values)).rows, [{ id: 'c' }]);
  console.log('PASS PostgreSQL: 11 search/filter/count cases + pagination; SELECT fixtures only');
} finally {
  await db.end();
}
