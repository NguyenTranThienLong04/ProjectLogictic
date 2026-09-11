import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingState } from '../../components/ui/loading-state';
import { CreateStaffPage } from '../../features/auth/pages/create-staff-page';
import { CodDashboardPage } from '../../features/cod/cod-dashboard-page';
import { DispatcherDriverMapPage } from '../../features/locations/dispatcher-driver-map-page';
import { LineHaulOperationsMapPage } from '../../features/locations/line-haul-operations-map-page';
import { AdminLineHaulVehiclesPage } from '../../features/line-haul/admin-line-haul-vehicles-page';
import { LineHaulTripDetailPage } from '../../features/line-haul/line-haul-trip-detail-page';
import { LineHaulTripsPage } from '../../features/line-haul/line-haul-trips-page';
import { AdminDriversPage } from '../../features/operations/admin-drivers-page';
import { DispatcherDeliveriesPage } from '../../features/operations/dispatcher-deliveries-page';
import { DispatcherPickupsPage } from '../../features/operations/dispatcher-pickups-page';
import { PricingConfigPage } from '../../features/pricing/pricing-config-page';
import { AdminWarehousesPage } from '../../features/warehouses/pages/admin-warehouses-page';
import { WarehouseWorkspacePage } from '../../features/warehouses/pages/warehouse-workspace-page';
import { AdminDashboardPage } from '../../features/dashboards/admin-dashboard-page';
import { AdminUsersPage } from '../../features/admin/admin-users-page';
import { AuditLogsPage } from '../../features/admin/audit-logs-page';
import { AdminShipmentsPage } from '../../features/operations/operational-shipments-page';
import { OperationalShipmentDetailPage } from '../../features/operations/operational-shipment-detail-page';
import { AdminShippingFeeReconciliationPage } from '../../features/shipping-fees/admin-shipping-fee-reconciliation-page';

const AdminAnalyticsPage = lazy(() =>
  import('../../features/analytics/admin-analytics-page').then((module) => ({
    default: module.AdminAnalyticsPage,
  })),
);

export function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminDashboardPage />} path="/admin/dashboard" />
      <Route element={<AdminShipmentsPage />} path="/admin/shipments" />
      <Route element={<OperationalShipmentDetailPage role="admin" />} path="/admin/shipments/:id" />
      <Route element={<AdminUsersPage />} path="/admin/users" />
      <Route element={<AuditLogsPage />} path="/admin/audit-logs" />
      <Route element={<CreateStaffPage />} path="/admin/staff/new" />
      <Route element={<PricingConfigPage />} path="/admin/pricing" />
      <Route element={<AdminDriversPage />} path="/admin/drivers" />
      <Route element={<AdminLineHaulVehiclesPage />} path="/admin/line-haul/vehicles" />
      <Route element={<LineHaulTripsPage />} path="/admin/line-haul/trips" />
      <Route element={<LineHaulTripDetailPage />} path="/admin/line-haul/trips/:id" />
      <Route element={<LineHaulOperationsMapPage />} path="/admin/line-haul/map" />
      <Route element={<AdminWarehousesPage />} path="/admin/warehouses" />
      <Route element={<CodDashboardPage />} path="/admin/cod" />
      <Route element={<AdminShippingFeeReconciliationPage />} path="/admin/shipping-fees" />
      <Route
        element={
          <Suspense fallback={<LoadingState label="Đang tải trang analytics" />}>
            <AdminAnalyticsPage />
          </Suspense>
        }
        path="/admin/analytics"
      />
      <Route element={<DispatcherPickupsPage />} path="/dispatcher/pickups" />
      <Route element={<DispatcherDeliveriesPage />} path="/dispatcher/deliveries" />
      <Route element={<DispatcherDriverMapPage />} path="/dispatcher/drivers/map" />
      <Route element={<WarehouseWorkspacePage />} path="/warehouse" />
      <Route element={<WarehouseWorkspacePage />} path="/warehouse/workspace" />
      <Route element={<Navigate replace to="/admin/dashboard" />} path="*" />
    </Routes>
  );
}
