import { Navigate, Route, Routes } from 'react-router-dom';
import { WarehouseWorkspacePage } from '../../features/warehouses/pages/warehouse-workspace-page';
import { WarehouseExceptionsPage } from '../../features/warehouses/pages/warehouse-exceptions-page';
import { LineHaulTripDetailPage } from '../../features/line-haul/line-haul-trip-detail-page';
import { WarehouseLineHaulPage } from '../../features/line-haul/warehouse-line-haul-page';
import { LineHaulOperationsMapPage } from '../../features/locations/line-haul-operations-map-page';

export function WarehouseRoutes() {
  return (
    <Routes>
      <Route element={<WarehouseWorkspacePage />} path="/warehouse" />
      <Route element={<WarehouseWorkspacePage />} path="/warehouse/workspace" />
      <Route element={<WarehouseExceptionsPage />} path="/warehouse/exceptions" />
      <Route element={<WarehouseLineHaulPage />} path="/warehouse/line-haul" />
      <Route element={<LineHaulTripDetailPage />} path="/warehouse/line-haul/:id" />
      <Route element={<LineHaulOperationsMapPage />} path="/warehouse/line-haul/map" />
      <Route element={<Navigate replace to="/warehouse/workspace" />} path="*" />
    </Routes>
  );
}
