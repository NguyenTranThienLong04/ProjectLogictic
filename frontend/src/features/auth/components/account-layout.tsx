import type { PropsWithChildren } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { LogoMark } from '../../../components/logo-mark';
import { Button } from '../../../components/ui/button';
import type { UserRole } from '../../../types/auth';
import { NotificationBell } from '../../notifications/notification-bell';
import { useAuth } from '../auth-context';

interface NavigationItem {
  label: string;
  to: string;
}

const primaryNavigation: Record<UserRole, NavigationItem[]> = {
  CUSTOMER: [
    { label: 'Dashboard', to: '/dashboard' },
    { label: 'Báo giá', to: '/quote' },
    { label: 'Vận đơn', to: '/shipments' },
    { label: 'Địa chỉ', to: '/addresses' },
  ],
  DRIVER: [
    { label: 'Dashboard', to: '/driver/dashboard' },
    { label: 'Lấy hàng', to: '/driver/assignments' },
    { label: 'Giao hàng', to: '/driver/deliveries' },
    { label: 'Bản đồ', to: '/driver/map' },
    { label: 'Lịch sử', to: '/driver/delivery-history' },
  ],
  WAREHOUSE_STAFF: [
    { label: 'Không gian kho', to: '/warehouse/workspace' },
    { label: 'Chuyến liên kho', to: '/warehouse/line-haul' },
    { label: 'Bản đồ liên kho', to: '/warehouse/line-haul/map' },
    { label: 'Ngoại lệ', to: '/warehouse/exceptions' },
  ],
  DISPATCHER: [
    { label: 'Dashboard', to: '/dispatcher/dashboard' },
    { label: 'Vận đơn', to: '/dispatcher/shipments' },
    { label: 'Lấy hàng', to: '/dispatcher/pickups' },
    { label: 'Giao hàng', to: '/dispatcher/deliveries' },
    { label: 'Tài xế', to: '/dispatcher/drivers' },
  ],
  ADMIN: [
    { label: 'Dashboard', to: '/admin/dashboard' },
    { label: 'Vận đơn', to: '/admin/shipments' },
    { label: 'Người dùng', to: '/admin/users' },
    { label: 'Analytics', to: '/admin/analytics' },
  ],
};

const secondaryNavigation: Partial<Record<UserRole, NavigationItem[]>> = {
  DRIVER: [
    { label: 'Bàn giao phí', to: '/driver/shipping-fees' },
    { label: 'Chuyến liên kho', to: '/driver/line-haul' },
  ],
  DISPATCHER: [
    { label: 'Chuyến liên kho', to: '/dispatcher/line-haul' },
    { label: 'Bản đồ liên kho', to: '/dispatcher/line-haul/map' },
    { label: 'Giao thất bại', to: '/dispatcher/failed-deliveries' },
    { label: 'Hoàn hàng', to: '/dispatcher/returns' },
    { label: 'Ngoại lệ', to: '/dispatcher/exceptions' },
    { label: 'Bản đồ tài xế', to: '/dispatcher/drivers/map' },
    { label: 'Kho vận', to: '/warehouse/workspace' },
  ],
  ADMIN: [
    { label: 'Tài xế', to: '/admin/drivers' },
    { label: 'Xe tuyến liên kho', to: '/admin/line-haul/vehicles' },
    { label: 'Chuyến liên kho', to: '/admin/line-haul/trips' },
    { label: 'Bản đồ liên kho', to: '/admin/line-haul/map' },
    { label: 'Kho hàng', to: '/admin/warehouses' },
    { label: 'Bảng giá', to: '/admin/pricing' },
    { label: 'COD', to: '/admin/cod' },
    { label: 'Đối soát phí', to: '/admin/shipping-fees' },
    { label: 'Audit Logs', to: '/admin/audit-logs' },
    { label: 'Tạo tài khoản', to: '/admin/staff/new' },
  ],
};

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `focus-ring ui-transition inline-flex min-h-12 items-center justify-center rounded-control px-3 text-sm font-semibold transition-colors ${
    isActive
      ? 'bg-primary-soft text-primary'
      : 'text-muted-foreground hover:bg-surface-muted hover:text-ink'
  }`;

export function AccountLayout({ children }: PropsWithChildren) {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true });
    }
  };
  const primary = user ? primaryNavigation[user.role] : [];
  const secondary = user ? secondaryNavigation[user.role] : undefined;
  const denseRole = user?.role === 'DRIVER' || user?.role === 'ADMIN';

  return (
    <div className="min-h-dvh bg-background text-ink">
      <a className="skip-link" href="#account-content">
        Đến nội dung chính
      </a>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-18 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            className="focus-ring inline-flex min-h-12 items-center gap-3 rounded-control font-semibold"
            to="/"
          >
            <LogoMark className="size-10 text-primary" />
            <span className="hidden sm:inline">Logistics Operations</span>
            <span className="sm:hidden">Logistics</span>
          </Link>
          <nav
            aria-label="Không gian làm việc"
            className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap"
          >
            {primary.map((item) => (
              <NavLink className={navLinkClass} key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ))}
            {secondary?.length ? (
              <details className="relative col-span-2 sm:col-span-1">
                <summary className="focus-ring ui-transition flex min-h-12 cursor-pointer list-none items-center justify-center rounded-control px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-muted hover:text-ink">
                  Thêm
                </summary>
                <section className="absolute right-0 z-40 mt-2 grid min-w-56 gap-1 rounded-surface border border-border bg-surface p-2 shadow-floating">
                  {secondary.map((item) => (
                    <NavLink className={navLinkClass} key={item.to} to={item.to}>
                      {item.label}
                    </NavLink>
                  ))}
                </section>
              </details>
            ) : null}
            <NavLink className={navLinkClass} to="/profile">
              Hồ sơ
            </NavLink>
            {user ? <NotificationBell /> : null}
            <Button
              className="col-span-2 min-h-12 w-full px-4 text-sm sm:col-span-1 sm:w-auto"
              onClick={handleLogout}
              variant="secondary"
            >
              Đăng xuất
            </Button>
          </nav>
        </div>
      </header>
      <main
        className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${denseRole ? 'py-6 sm:py-8 lg:py-10' : 'py-8 sm:py-10'}`}
        id="account-content"
      >
        {children}
      </main>
    </div>
  );
}
