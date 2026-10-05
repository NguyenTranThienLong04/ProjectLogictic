import type { OperationsRole, TowerItem } from './control-tower-types';

export const stageLabels: Record<string, string> = {
  PENDING: 'Chờ xác nhận',
  PICKUP: 'Pickup → nhập kho',
  ORIGIN_DWELL: 'Lưu kho origin',
  TRANSIT: 'Trung chuyển',
  DESTINATION_DWELL: 'Kho / chờ giao',
  DELIVERY: 'Giao hàng',
  DELIVERY_FAILED: 'Giao thất bại',
  RETURN_REQUESTED: 'Chờ hoàn hàng',
  RETURN_IN_TRANSIT: 'Đang hoàn hàng',
  DAMAGED: 'Hư hỏng',
  LOST: 'Thất lạc',
  PLANNED: 'Lập kế hoạch',
  READY: 'Chờ khởi hành',
};
export const slaLabels: Record<string, string> = {
  ON_TIME: 'Đúng hạn',
  AT_RISK: 'Sắp quá SLA',
  OVERDUE: 'Quá SLA',
  UNAVAILABLE: 'Chưa xác định / chưa áp dụng',
};
export const sortLabels = {
  PRIORITY: 'Ưu tiên vận hành',
  AGING_DESC: 'Aging lâu nhất',
  DEADLINE_ASC: 'Deadline sớm nhất',
  CREATED_DESC: 'Mới tạo trước',
  CODE_ASC: 'Mã A → Z',
};
export function agingLabel(seconds: number | null) {
  if (seconds === null) return 'Chưa xác định';
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
export function tripPath(role: OperationsRole, id: string) {
  return role === 'admin' ? `/admin/line-haul/trips/${id}` : `/dispatcher/line-haul/${id}`;
}
export function itemPath(role: OperationsRole, item: Pick<TowerItem, 'id' | 'entityType'>) {
  return item.entityType === 'TRIP' ? tripPath(role, item.id) : `/${role}/shipments/${item.id}`;
}
export function transferPath(role: OperationsRole, warehouseId: string, id: string) {
  return `/${role}/warehouses/${warehouseId}/transfers/${id}`;
}
export function exceptionLabel(exception: string | null) {
  if (!exception) return null;
  return (
    (
      {
        TIMESTAMP_MISSING: 'Thiếu mốc thời gian',
        TIMESTAMP_INCONSISTENT: 'Mốc thời gian không nhất quán',
        MISSING_ACTIVE_TRANSFER: 'Thiếu transfer đang hoạt động',
      } as Record<string, string>
    )[exception] ??
    stageLabels[exception] ??
    exception
  );
}
export function localDateInput(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
