import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Navigate } from 'react-router-dom';
import { LoadingState } from '../../components/ui/loading-state';
import { useAuth } from '../../features/auth/auth-context';
import type { UserRole } from '../../types/auth';

const roleRoutes: Record<UserRole, LazyExoticComponent<ComponentType>> = {
  CUSTOMER: lazy(() =>
    import('./customer-routes').then((module) => ({ default: module.CustomerRoutes })),
  ),
  DRIVER: lazy(() =>
    import('./driver-routes').then((module) => ({ default: module.DriverRoutes })),
  ),
  DISPATCHER: lazy(() =>
    import('./dispatcher-routes').then((module) => ({ default: module.DispatcherRoutes })),
  ),
  WAREHOUSE_STAFF: lazy(() =>
    import('./warehouse-routes').then((module) => ({ default: module.WarehouseRoutes })),
  ),
  ADMIN: lazy(() => import('./admin-routes').then((module) => ({ default: module.AdminRoutes }))),
};

export function AuthenticatedRoleRoutes() {
  const { user } = useAuth();

  if (!user) return <Navigate replace to="/login" />;

  const RoleRoutes = roleRoutes[user.role];
  return (
    <Suspense fallback={<LoadingState label="Đang tải không gian làm việc" />}>
      <RoleRoutes />
    </Suspense>
  );
}
