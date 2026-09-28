import type {
  CODTransactionStatus,
  Shipment,
  ShipmentStatus,
  ShippingFeePayer,
  ShippingFeeTransaction,
  TrackingEvent,
} from '../../generated/prisma/client.js';
import type { PricingBreakdown } from '../pricing/pricing.types.js';
import type { ShippingFeeTransactionResponse } from '../shipping-fees/shipping-fee.response.js';

export interface ContactSnapshot {
  fullName: string;
  email?: string;
  phone: string | null;
}

export interface AddressSnapshot {
  contactName: string;
  phone: string;
  streetAddress: string;
  ward: string;
  district: string;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface PackageSnapshot {
  description: string;
  packageType: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  verifiedWeightGrams?: number;
  verifiedDimensions?: PackageDimensions;
  verifiedAt?: string;
  verifiedByStaffId?: string;
}

export interface PackageDimensions {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface TrackingEventResponse {
  id: string;
  status: ShipmentStatus;
  type: string;
  title: string;
  description: string | null;
  createdAt: Date;
}

export interface ShipmentResponse {
  codStatus?: CODTransactionStatus | null;
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  sender: ContactSnapshot;
  receiver: ContactSnapshot;
  pickup: AddressSnapshot;
  delivery: AddressSnapshot;
  package: PackageSnapshot;
  pricing: PricingBreakdown;
  codAmount: number;
  totalFee: number;
  shippingFeePayer: ShippingFeePayer;
  shippingFee: ShippingFeeTransactionResponse;
  canCancel: boolean;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  timeline: TrackingEventResponse[];
}

export interface ShipmentSummaryResponse {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  receiverName: string;
  deliveryCity: string;
  totalFee: number;
  codAmount: number;
  shippingFeePayer: ShippingFeePayer;
  shippingFee: ShippingFeeTransactionResponse;
  createdAt: Date;
}

export interface PaginatedShipmentsResponse {
  items: ShipmentSummaryResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type ShipmentWithTimeline = Shipment & {
  trackingEvents: TrackingEvent[];
  shippingFeeTransaction: ShippingFeeTransaction | null;
};

export type ShipmentWithShippingFee = Shipment & {
  shippingFeeTransaction: ShippingFeeTransaction | null;
};

// Legacy transfer descriptions contain free-form staff notes. Public/customer reads
// project lifecycle text without changing the append-only operational history.
export function mapPublicTimeline(event: TrackingEventResponse): TrackingEventResponse {
  const descriptions: Record<string, string> = {
    WAREHOUSE_TRANSFER_DISPATCHED: 'Kiện hàng đang được trung chuyển liên kho.',
    WAREHOUSE_TRANSFER_RECEIVED: 'Kiện hàng đã được tiếp nhận tại kho đích.',
  };
  return {
    id: event.id,
    status: event.status,
    type: event.type,
    title: event.title,
    description: descriptions[event.type] ?? event.description,
    createdAt: event.createdAt,
  };
}
