import { Prisma } from '../../generated/prisma/client.js';
import type { ListWarehousesDto } from './dto/list-warehouses.dto.js';

// PostgreSQL Unicode normalization avoids requiring an unaccent extension/migration.
function folded(value: Prisma.Sql): Prisma.Sql {
  const combiningMarks = '[\u0300-\u036f]';
  return Prisma.sql`translate(regexp_replace(normalize(lower(${value}), NFD), ${combiningMarks}, '', 'g'), 'đ', 'd')`;
}

export function warehouseListWhere(query: ListWarehousesDto): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (query.city?.trim()) {
    // Preserve the existing city substring contract for other catalogue consumers.
    conditions.push(Prisma.sql`strpos(lower("city"), lower(${query.city.trim()})) > 0`);
  }
  if (query.ward?.trim()) {
    conditions.push(Prisma.sql`lower("ward") = lower(${query.ward.trim()})`);
  }
  if (query.isActive !== undefined) {
    conditions.push(Prisma.sql`"isActive" = ${query.isActive}`);
  }
  if (query.search?.trim()) {
    const address = Prisma.sql`concat_ws(' ', "code", "name", "address", "ward", "district", "city")`;
    conditions.push(
      Prisma.sql`strpos(${folded(address)}, ${folded(Prisma.sql`${query.search.trim()}`)}) > 0`,
    );
  }
  return Prisma.join(conditions, ' AND ');
}
