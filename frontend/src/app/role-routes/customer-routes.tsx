import { Navigate, Route, Routes } from 'react-router-dom';
import { AddressesPage } from '../../features/addresses/addresses-page';
import { QuotePage } from '../../features/pricing/quote-page';
import { CreateShipmentPage } from '../../features/shipments/create-shipment-page';
import { ShipmentDetailPage } from '../../features/shipments/shipment-detail-page';
import { ShipmentsPage } from '../../features/shipments/shipments-page';
import { CustomerDashboardPage } from '../../features/dashboards/customer-dashboard-page';
import { ShippingFeePaymentResultPage } from '../../features/shipping-fees/shipping-fee-payment-result-page';

export function CustomerRoutes() {
  return (
    <Routes>
      <Route element={<CustomerDashboardPage />} path="/dashboard" />
      <Route element={<AddressesPage />} path="/addresses" />
      <Route element={<QuotePage />} path="/quote" />
      <Route element={<CreateShipmentPage />} path="/shipments/new" />
      <Route element={<ShipmentDetailPage />} path="/shipments/:id" />
      <Route element={<ShippingFeePaymentResultPage />} path="/payments/result" />
      <Route element={<ShipmentsPage />} path="/shipments" />
      <Route element={<Navigate replace to="/dashboard" />} path="*" />
    </Routes>
  );
}
