import { Navigate, Route, Routes } from 'react-router-dom';
import { DriverLocationProvider } from '../../features/locations/driver-location-provider';
import { DriverLineHaulPage } from '../../features/locations/driver-line-haul-page';
import { DriverAssignmentsPage } from '../../features/operations/driver-assignments-page';
import { DriverDeliveriesPage } from '../../features/operations/driver-deliveries-page';
import { DriverDashboardPage } from '../../features/dashboards/driver-dashboard-page';
import { DriverMapPage } from '../../features/locations/driver-map-page';
import { DeliveryDetailPage } from '../../features/operations/delivery-detail-page';
import { DeliveryHistoryPage } from '../../features/operations/delivery-history-page';
import { FailedDeliveryPage } from '../../features/operations/failed-delivery-page';
import { PickupDetailPage } from '../../features/operations/pickup-detail-page';
import { ProofOfDeliveryPage } from '../../features/operations/proof-of-delivery-page';
import { DriverShippingFeesPage } from '../../features/shipping-fees/driver-shipping-fees-page';

export function DriverRoutes() {
  return (
    <Routes>
      <Route element={<DriverLocationProvider />}>
        <Route element={<DriverDashboardPage />} path="/driver/dashboard" />
        <Route element={<DriverAssignmentsPage />} path="/driver/assignments" />
        <Route element={<PickupDetailPage />} path="/driver/pickups/:assignmentId" />
        <Route element={<DriverDeliveriesPage />} path="/driver/deliveries" />
        <Route element={<DeliveryDetailPage />} path="/driver/deliveries/:assignmentId" />
        <Route element={<ProofOfDeliveryPage />} path="/driver/deliveries/:assignmentId/proof" />
        <Route element={<FailedDeliveryPage />} path="/driver/deliveries/:assignmentId/failed" />
        <Route element={<DeliveryHistoryPage />} path="/driver/delivery-history" />
        <Route element={<DriverMapPage />} path="/driver/map" />
        <Route element={<DriverLineHaulPage />} path="/driver/line-haul" />
        <Route element={<DriverShippingFeesPage />} path="/driver/shipping-fees" />
      </Route>
      <Route element={<Navigate replace to="/driver/dashboard" />} path="*" />
    </Routes>
  );
}
