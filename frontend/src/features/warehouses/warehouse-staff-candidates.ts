import type { User } from '../../types/auth';
import type { WarehouseStaffProfile } from './warehouse-types';

export function getEligibleWarehouseStaffAccounts(
  users: readonly User[],
  profiles: readonly Pick<WarehouseStaffProfile, 'userId'>[],
): User[] {
  const assignedUserIds = new Set(profiles.map((profile) => profile.userId));

  return users
    .filter(
      (user) =>
        user.role === 'WAREHOUSE_STAFF' &&
        user.status === 'ACTIVE' &&
        !assignedUserIds.has(user.id),
    )
    .sort((left, right) =>
      left.fullName.localeCompare(right.fullName, 'vi', { sensitivity: 'base' }),
    );
}

export function filterWarehouseStaffAccounts(users: readonly User[], search: string): User[] {
  const normalizedSearch = search.trim().toLocaleLowerCase('vi');
  if (!normalizedSearch) return [...users];

  return users.filter((user) =>
    `${user.fullName} ${user.email}`.toLocaleLowerCase('vi').includes(normalizedSearch),
  );
}

export function warehouseStaffAccountLabel(user: Pick<User, 'email' | 'fullName'>): string {
  return `${user.fullName} — ${user.email}`;
}
