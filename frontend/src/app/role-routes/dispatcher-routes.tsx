import { Navigate, Route, Routes } from 'react-router-dom';
import { DispatcherDriverMapPage } from '../../features/locations/dispatcher-driver-map-page';
import { LineHaulOperationsMapPage } from '../../features/locations/line-haul-operations-map-page';
import { LineHaulTripDetailPage } from '../../features/line-haul/line-haul-trip-detail-page';
import { LineHaulTripsPage } from '../../features/line-haul/line-haul-trips-page';
import { DispatcherDeliveriesPage } from '../../features/operations/dispatcher-deliveries-page';
import { DispatcherPickupsPage } from '../../features/operations/dispatcher-pickups-page';
import { WarehouseWorkspacePage } from '../../features/warehouses/pages/warehouse-workspace-page';
import { DispatcherDashboardPage } from '../../features/dashboards/dispatcher-dashboard-page';
import { DriverAvailabilityPage } from '../../features/operations/driver-availability-page';
import {
  DispatcherExceptionsPage,
  DispatcherFailedDeliveriesPage,
  DispatcherReturnsPage,
  DispatcherShipmentsPage,
} from '../../features/operations/operational-shipments-page';
import { OperationalShipmentDetailPage } from '../../features/operations/operational-shipment-detail-page';

export function DispatcherRoutes() {
  return (
    <Routes>
      <Route element={<DispatcherDashboardPage />} path="/dispatcher/dashboard" />
      <Route element={<DispatcherShipmentsPage />} path="/dispatcher/shipments" />
      <Route
        element={<OperationalShipmentDetailPage role="dispatcher" />}
        path="/dispatcher/shipments/:id"
      />
      <Route element={<DispatcherPickupsPage />} path="/dispatcher/pickups" />
      <Route element={<DispatcherDeliveriesPage />} path="/dispatcher/deliveries" />
      <Route element={<DispatcherDriverMapPage />} path="/dispatcher/drivers/map" />
      <Route element={<DriverAvailabilityPage />} path="/dispatcher/drivers" />
      <Route element={<LineHaulTripsPage />} path="/dispatcher/line-haul" />
      <Route element={<LineHaulTripDetailPage />} path="/dispatcher/line-haul/:id" />
      <Route element={<LineHaulOperationsMapPage />} path="/dispatcher/line-haul/map" />
      <Route element={<DispatcherFailedDeliveriesPage />} path="/dispatcher/failed-deliveries" />
      <Route element={<DispatcherReturnsPage />} path="/dispatcher/returns" />
      <Route element={<DispatcherExceptionsPage />} path="/dispatcher/exceptions" />
      <Route element={<WarehouseWorkspacePage />} path="/warehouse" />
      <Route element={<WarehouseWorkspacePage />} path="/warehouse/workspace" />
      <Route element={<Navigate replace to="/dispatcher/dashboard" />} path="*" />
    </Routes>
  );
}
