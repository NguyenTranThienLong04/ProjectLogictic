import type { UserRole } from '../types/auth';

export function roleHomePath(role: UserRole): string {
  if (role === 'CUSTOMER') return '/dashboard';
  if (role === 'DRIVER') return '/driver/dashboard';
  if (role === 'DISPATCHER') return '/dispatcher/dashboard';
  if (role === 'WAREHOUSE_STAFF') return '/warehouse/workspace';
  return '/admin/dashboard';
}
