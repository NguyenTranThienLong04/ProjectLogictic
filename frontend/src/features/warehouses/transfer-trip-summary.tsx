import { Link } from 'react-router-dom';
import { LineHaulTripStatusBadge } from '../../components/ui/status-badge';
import { formatDateTime } from '../../utils/format';
import type { WarehouseTransfer } from './warehouse-types';

export function TransferTripSummary({ transfer }: { transfer: WarehouseTransfer }) {
  const trip = transfer.lineHaulTrip;
  if (!trip) return <p className="max-w-64 text-sm text-muted-foreground">{
    transfer.status === 'PENDING' ? 'Đang chờ điều phối chuyến trung chuyển'
      : transfer.workflow?.legacyStandalone ? 'Transfer xuất trước chuyển đổi · nhận tại kho đích'
        : 'Transfer không gắn chuyến'
  }</p>;
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <Link className="focus-ring font-semibold text-primary underline" to={`/warehouse/line-haul/${trip.id}`}>{trip.tripCode}</Link>
      <div><LineHaulTripStatusBadge status={trip.status} /></div>
      <p>Xe: {trip.vehicle ? `${trip.vehicle.vehicleCode} · ${trip.vehicle.licensePlate}` : 'Xem chi tiết chuyến'}</p>
      <p>Tài xế: {trip.driver?.fullName ?? 'Xem chi tiết chuyến'}</p>
      <p className="text-muted-foreground">Khởi hành: {trip.scheduledStartAt ? formatDateTime(trip.scheduledStartAt) : 'Chưa xếp lịch'}</p>
    </div>
  );
}
