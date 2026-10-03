import type { WarehouseShipment, WarehouseTransfer } from './warehouse-types';

export interface TransferContext {
  shipment: WarehouseShipment | null;
  activeTransfer: WarehouseTransfer | undefined;
}

export function transferBlockReason(context: TransferContext, warehouseId: string): string | undefined {
  const { shipment, activeTransfer } = context;
  if (!shipment || shipment.currentWarehouseId !== warehouseId) return 'Vận đơn không còn trong tồn kho này. Hãy tải lại danh sách.';
  if (activeTransfer) return `Vận đơn đã có transfer ${activeTransfer.transferCode}. Hãy mở danh sách chuyến gửi đi.`;
  if (shipment.status !== 'AT_ORIGIN_WAREHOUSE') return 'Trạng thái vận đơn hiện tại không cho phép tạo transfer liên kho.';
  if (!shipment.destinationWarehouseId) return 'Chưa xác nhận kho đích. Hãy Phân loại vận đơn trước khi tạo transfer.';
  if (shipment.destinationWarehouseId === warehouseId) return 'Kho đích trùng kho hiện tại; vận đơn không cần transfer liên kho.';
  if (!shipment.destinationWarehouse || shipment.destinationWarehouse.id !== shipment.destinationWarehouseId) {
    return 'Thông tin kho đích chưa đồng nhất. Hãy tải lại và kiểm tra Phân loại.';
  }
  if (shipment.destinationWarehouse.isActive === false) return 'Kho đích đã ngừng hoạt động. Hãy Phân loại lại sang kho đang hoạt động.';
}
