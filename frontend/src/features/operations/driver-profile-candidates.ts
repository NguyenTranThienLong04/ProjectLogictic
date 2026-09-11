import type { User } from '../../types/auth';
import type { DriverProfile } from './operations-types';

export function getEligibleDriverAccounts(
  users: readonly User[],
  profiles: readonly Pick<DriverProfile, 'userId'>[],
): User[] {
  const linkedUserIds = new Set(profiles.map((profile) => profile.userId));

  return users
    .filter(
      (user) =>
        user.role === 'DRIVER' && user.status === 'ACTIVE' && !linkedUserIds.has(user.id),
    )
    .sort((left, right) =>
      left.fullName.localeCompare(right.fullName, 'vi', { sensitivity: 'base' }),
    );
}

export function filterDriverAccounts(users: readonly User[], search: string): User[] {
  const normalizedSearch = search.trim().toLocaleLowerCase('vi');
  if (!normalizedSearch) return [...users];

  return users.filter((user) =>
    `${user.fullName} ${user.email}`.toLocaleLowerCase('vi').includes(normalizedSearch),
  );
}

export function driverAccountLabel(user: Pick<User, 'email' | 'fullName'>): string {
  return `${user.fullName} — ${user.email}`;
}
