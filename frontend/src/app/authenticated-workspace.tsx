import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { LoadingState } from '../components/ui/loading-state';
import { useAuth } from '../features/auth/auth-context';

const DriverWorkspace = lazy(() =>
  import('../features/locations/driver-location-provider').then((module) => ({
    default: module.DriverLocationProvider,
  })),
);

export function AuthenticatedWorkspace() {
  const { user } = useAuth();
  return (
    <Suspense fallback={<LoadingState label="Đang tải không gian làm việc" />}>
      {user?.role === 'DRIVER' ? <DriverWorkspace key={user.id} /> : <Outlet />}
    </Suspense>
  );
}
