import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingState } from '../components/ui/loading-state';
import { ErrorState } from '../components/ui/error-state';
import { useAuth } from '../features/auth/auth-context';
import type { UserRole } from '../types/auth';
import { roleHomePath } from '../utils/role-home';

function RestoreError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-xl p-4 sm:p-8">
      <ErrorState
        title="Chưa thể khôi phục phiên đăng nhập"
        message="Không thể xác minh phiên lúc này. Vui lòng kiểm tra kết nối và thử lại."
        onRetry={onRetry}
      />
    </div>
  );
}

export function GuestRoute() {
  const { status, user, retryRestore } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <LoadingState label="Đang kiểm tra phiên đăng nhập" />;
  if (status === 'restore-error') return <RestoreError onRetry={retryRestore} />;
  if (status === 'authenticated' && user) {
    const requestedPath = (location.state as { from?: string } | null)?.from;
    return (
      <Navigate
        replace
        to={
          user?.mustChangePassword ? '/change-password' : requestedPath || roleHomePath(user.role)
        }
      />
    );
  }
  return <Outlet />;
}

export function ProtectedRoute({
  allowPasswordChangeRequired = false,
  roles,
}: {
  allowPasswordChangeRequired?: boolean;
  roles?: UserRole[];
}) {
  const { status, user, retryRestore } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <LoadingState label="Đang khôi phục phiên đăng nhập" />;
  if (status === 'restore-error') return <RestoreError onRetry={retryRestore} />;
  if (status === 'guest' || !user) {
    return (
      <Navigate
        replace
        state={{ from: location.pathname + location.search + location.hash }}
        to="/login"
      />
    );
  }
  if (user.mustChangePassword && !allowPasswordChangeRequired) {
    return <Navigate replace to="/change-password" />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate replace to="/profile" />;
  }
  return <Outlet />;
}
