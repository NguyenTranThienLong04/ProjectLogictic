import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingState } from '../components/ui/loading-state';
import { GuestRoute, ProtectedRoute } from './route-guards';
import { AuthenticatedRoleRoutes } from './role-routes/authenticated-role-routes';

const ChangePasswordPage = lazy(() =>
  import('../features/auth/pages/change-password-page').then((module) => ({
    default: module.ChangePasswordPage,
  })),
);
const ForgotPasswordPage = lazy(() =>
  import('../features/auth/pages/forgot-password-page').then((module) => ({
    default: module.ForgotPasswordPage,
  })),
);
const LoginPage = lazy(() =>
  import('../features/auth/pages/login-page').then((module) => ({ default: module.LoginPage })),
);
const ProfilePage = lazy(() =>
  import('../features/auth/pages/profile-page').then((module) => ({ default: module.ProfilePage })),
);
const RegisterPage = lazy(() =>
  import('../features/auth/pages/register-page').then((module) => ({
    default: module.RegisterPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import('../features/auth/pages/reset-password-page').then((module) => ({
    default: module.ResetPasswordPage,
  })),
);
const FoundationPage = lazy(() =>
  import('../features/foundation/foundation-page').then((module) => ({
    default: module.FoundationPage,
  })),
);
const NotificationsPage = lazy(() =>
  import('../features/notifications/notifications-page').then((module) => ({
    default: module.NotificationsPage,
  })),
);
const PublicTrackingPage = lazy(() =>
  import('../features/shipments/public-tracking-page').then((module) => ({
    default: module.PublicTrackingPage,
  })),
);

export function App() {
  return (
    <Suspense fallback={<LoadingState label="Đang tải trang" />}>
      <Routes>
        <Route element={<FoundationPage />} path="/" />
        <Route element={<GuestRoute />}>
          <Route element={<LoginPage />} path="/login" />
          <Route element={<RegisterPage />} path="/register" />
        </Route>
        <Route element={<ForgotPasswordPage />} path="/forgot-password" />
        <Route element={<ResetPasswordPage />} path="/reset-password" />
        <Route element={<PublicTrackingPage />} path="/tracking" />
        <Route element={<ProtectedRoute allowPasswordChangeRequired />}>
          <Route element={<ChangePasswordPage />} path="/change-password" />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<ProfilePage />} path="/profile" />
          <Route element={<NotificationsPage />} path="/notifications" />
          <Route element={<AuthenticatedRoleRoutes />} path="/*" />
        </Route>
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </Suspense>
  );
}
