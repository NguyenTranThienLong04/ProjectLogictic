export interface StatusBadgeAppearance {
  label: string;
  surface: string;
  dot: string;
}

export const shipmentStatusBadgeConfig = {
  PENDING: {
    label: 'Chờ xác nhận',
    surface: 'border-amber-200 bg-amber-50 text-amber-800',
    dot: 'bg-amber-400',
  },
  CONFIRMED: {
    label: 'Đã xác nhận',
    surface: 'border-blue-200 bg-blue-50 text-blue-800',
    dot: 'bg-blue-400',
  },
  AWAITING_PICKUP_ASSIGNMENT: {
    label: 'Chờ phân công lấy hàng',
    surface: 'border-indigo-200 bg-indigo-50 text-indigo-800',
    dot: 'bg-indigo-400',
  },
  PICKUP_ASSIGNED: {
    label: 'Đã phân công lấy hàng',
    surface: 'border-violet-200 bg-violet-50 text-violet-800',
    dot: 'bg-violet-400',
  },
  PICKUP_IN_PROGRESS: {
    label: 'Đang lấy hàng',
    surface: 'border-cyan-200 bg-cyan-50 text-cyan-900',
    dot: 'bg-cyan-500',
  },
  PICKED_UP: {
    label: 'Đã lấy hàng',
    surface: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    dot: 'bg-emerald-400',
  },
  AT_ORIGIN_WAREHOUSE: {
    label: 'Tại kho xuất phát',
    surface: 'border-teal-200 bg-teal-50 text-teal-800',
    dot: 'bg-teal-400',
  },
  IN_TRANSIT: {
    label: 'Đang trung chuyển liên kho',
    surface: 'border-sky-300 bg-sky-100 text-sky-900',
    dot: 'bg-sky-500',
  },
  AT_DESTINATION_WAREHOUSE: {
    label: 'Tại kho đích',
    surface: 'border-teal-300 bg-teal-100 text-teal-900',
    dot: 'bg-teal-500',
  },
  AWAITING_DELIVERY_ASSIGNMENT: {
    label: 'Chờ phân công giao hàng',
    surface: 'border-indigo-300 bg-indigo-100 text-indigo-900',
    dot: 'bg-indigo-500',
  },
  DELIVERY_ASSIGNED: {
    label: 'Đã phân công giao hàng',
    surface: 'border-violet-300 bg-violet-100 text-violet-900',
    dot: 'bg-violet-500',
  },
  OUT_FOR_DELIVERY: {
    label: 'Đang giao hàng',
    surface: 'border-cyan-300 bg-cyan-100 text-cyan-950',
    dot: 'bg-cyan-600',
  },
  DELIVERED: {
    label: 'Đã giao thành công',
    surface: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    dot: 'bg-emerald-600',
  },
  DELIVERY_FAILED: {
    label: 'Giao chưa thành công',
    surface: 'border-orange-600 bg-orange-500 text-slate-950',
    dot: 'bg-slate-950',
  },
  RETURN_REQUESTED: {
    label: 'Đã yêu cầu hoàn',
    surface: 'border-amber-400 bg-amber-200 text-amber-950',
    dot: 'bg-amber-600',
  },
  RETURN_IN_TRANSIT: {
    label: 'Đang hoàn hàng',
    surface: 'border-amber-500 bg-amber-300 text-amber-950',
    dot: 'bg-amber-700',
  },
  RETURNED: {
    label: 'Đã hoàn hàng',
    surface: 'border-amber-300 bg-amber-100 text-amber-900',
    dot: 'bg-amber-700',
  },
  CANCELLED: {
    label: 'Đã hủy',
    surface: 'border-slate-300 bg-slate-100 text-slate-700',
    dot: 'bg-slate-500',
  },
  DAMAGED: {
    label: 'Hàng hư hỏng',
    surface: 'border-red-300 bg-red-100 text-red-900',
    dot: 'bg-red-600',
  },
  LOST: {
    label: 'Thất lạc',
    surface: 'border-red-700 bg-red-600 text-white',
    dot: 'bg-white',
  },
} as const satisfies Record<string, StatusBadgeAppearance>;

export const warehouseTransferStatusBadgeConfig = {
  PENDING: {
    label: 'Chờ xuất kho',
    surface: 'border-orange-300 bg-orange-100 text-orange-900',
    dot: 'bg-orange-500',
  },
  IN_TRANSIT: {
    label: 'Đang trung chuyển',
    surface: 'border-sky-300 bg-sky-100 text-sky-900',
    dot: 'bg-sky-500',
  },
  COMPLETED: {
    label: 'Đã tiếp nhận',
    surface: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    dot: 'bg-emerald-600',
  },
  CANCELLED: {
    label: 'Đã hủy',
    surface: 'border-slate-300 bg-slate-100 text-slate-700',
    dot: 'bg-slate-500',
  },
} as const satisfies Record<string, StatusBadgeAppearance>;

export const codStatusBadgeConfig = {
  PENDING: {
    label: 'Chờ thu COD',
    surface: 'border-orange-200 bg-orange-50 text-orange-800',
    dot: 'bg-orange-400',
  },
  COLLECTED: {
    label: 'Đã thu COD',
    surface: 'border-orange-300 bg-orange-100 text-orange-900',
    dot: 'bg-orange-500',
  },
  REMITTED: {
    label: 'Tài xế đã nộp COD',
    surface: 'border-orange-400 bg-orange-200 text-orange-950',
    dot: 'bg-orange-600',
  },
  SETTLED: {
    label: 'Đã quyết toán COD',
    surface: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    dot: 'bg-emerald-600',
  },
  DISPUTED: {
    label: 'COD đang tranh chấp',
    surface: 'border-red-700 bg-red-600 text-white',
    dot: 'bg-white',
  },
} as const satisfies Record<string, StatusBadgeAppearance>;

export const shippingFeeStatusBadgeConfig = {
  PENDING: {
    label: 'Chờ thu phí vận chuyển',
    surface: 'border-indigo-200 bg-indigo-50 text-indigo-800',
    dot: 'bg-indigo-500',
  },
  PAYMENT_PENDING: {
    label: 'Đang chờ xác nhận thanh toán',
    surface: 'border-violet-300 bg-violet-100 text-violet-900',
    dot: 'bg-violet-600',
  },
  PAID: {
    label: 'Đã thanh toán trực tuyến',
    surface: 'border-teal-300 bg-teal-100 text-teal-900',
    dot: 'bg-teal-600',
  },
  COLLECTED: {
    label: 'Đã thu phí vận chuyển',
    surface: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    dot: 'bg-emerald-600',
  },
  REMITTED: {
    label: 'Tài xế đã bàn giao phí',
    surface: 'border-blue-300 bg-blue-100 text-blue-900',
    dot: 'bg-blue-600',
  },
  SETTLED: {
    label: 'Đã đối soát phí vận chuyển',
    surface: 'border-teal-300 bg-teal-100 text-teal-900',
    dot: 'bg-teal-600',
  },
  DISPUTED: {
    label: 'Phí vận chuyển đang tranh chấp',
    surface: 'border-red-700 bg-red-600 text-white',
    dot: 'bg-white',
  },
  CANCELLED: {
    label: 'Đã hủy thu phí',
    surface: 'border-slate-300 bg-slate-100 text-slate-700',
    dot: 'bg-slate-500',
  },
} as const satisfies Record<string, StatusBadgeAppearance>;

export const deliveryFailureReasonBadgeConfig = {
  RECIPIENT_UNAVAILABLE: {
    label: 'Không liên hệ được người nhận',
    surface: 'border-amber-200 bg-amber-50 text-amber-800',
    dot: 'bg-amber-400',
  },
  RECIPIENT_REJECTED: {
    label: 'Người nhận từ chối',
    surface: 'border-red-200 bg-red-50 text-red-800',
    dot: 'bg-red-400',
  },
  WRONG_ADDRESS: {
    label: 'Sai địa chỉ',
    surface: 'border-violet-200 bg-violet-50 text-violet-800',
    dot: 'bg-violet-400',
  },
  INVALID_PHONE: {
    label: 'Số điện thoại không hợp lệ',
    surface: 'border-rose-200 bg-rose-50 text-rose-800',
    dot: 'bg-rose-400',
  },
  ADDRESS_NOT_FOUND: {
    label: 'Không tìm thấy địa chỉ',
    surface: 'border-violet-400 bg-violet-200 text-violet-950',
    dot: 'bg-violet-600',
  },
  VEHICLE_ISSUE: {
    label: 'Sự cố phương tiện',
    surface: 'border-orange-300 bg-orange-100 text-orange-900',
    dot: 'bg-orange-500',
  },
  WEATHER: {
    label: 'Thời tiết không phù hợp',
    surface: 'border-sky-300 bg-sky-100 text-sky-900',
    dot: 'bg-sky-500',
  },
  OTHER: {
    label: 'Lý do khác',
    surface: 'border-slate-300 bg-slate-100 text-slate-700',
    dot: 'bg-slate-500',
  },
} as const satisfies Record<string, StatusBadgeAppearance>;

export const lineHaulVehicleStatusBadgeConfig = {
  AVAILABLE: {
    label: 'Sẵn sàng',
    surface: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    dot: 'bg-emerald-600',
  },
  IN_USE: {
    label: 'Đang khai thác',
    surface: 'border-sky-300 bg-sky-100 text-sky-900',
    dot: 'bg-sky-500',
  },
  MAINTENANCE: {
    label: 'Bảo trì',
    surface: 'border-orange-300 bg-orange-100 text-orange-900',
    dot: 'bg-orange-500',
  },
  INACTIVE: {
    label: 'Ngừng khai thác',
    surface: 'border-slate-300 bg-slate-100 text-slate-700',
    dot: 'bg-slate-500',
  },
} as const satisfies Record<string, StatusBadgeAppearance>;

export const lineHaulTripStatusBadgeConfig = {
  PLANNED: {
    label: 'Đã lập kế hoạch',
    surface: 'border-blue-200 bg-blue-50 text-blue-800',
    dot: 'bg-blue-500',
  },
  READY: {
    label: 'Sẵn sàng xuất phát',
    surface: 'border-indigo-300 bg-indigo-100 text-indigo-900',
    dot: 'bg-indigo-500',
  },
  IN_TRANSIT: {
    label: 'Đang chạy tuyến',
    surface: 'border-sky-300 bg-sky-100 text-sky-900',
    dot: 'bg-sky-500',
  },
  ARRIVED: {
    label: 'Đã đến kho đích',
    surface: 'border-emerald-300 bg-emerald-100 text-emerald-900',
    dot: 'bg-emerald-600',
  },
  CANCELLED: {
    label: 'Đã hủy',
    surface: 'border-slate-300 bg-slate-100 text-slate-700',
    dot: 'bg-slate-500',
  },
} as const satisfies Record<string, StatusBadgeAppearance>;

export type ShipmentBadgeStatus = keyof typeof shipmentStatusBadgeConfig;
export type WarehouseTransferBadgeStatus = keyof typeof warehouseTransferStatusBadgeConfig;
export type CodBadgeStatus = keyof typeof codStatusBadgeConfig;
export type ShippingFeeBadgeStatus = keyof typeof shippingFeeStatusBadgeConfig;
export type DeliveryFailureReasonBadgeStatus = keyof typeof deliveryFailureReasonBadgeConfig;
export type LineHaulVehicleBadgeStatus = keyof typeof lineHaulVehicleStatusBadgeConfig;
export type LineHaulTripBadgeStatus = keyof typeof lineHaulTripStatusBadgeConfig;
