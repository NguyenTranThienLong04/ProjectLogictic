export type ShipmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'AWAITING_PICKUP_ASSIGNMENT'
  | 'PICKUP_ASSIGNED'
  | 'PICKUP_IN_PROGRESS'
  | 'PICKED_UP'
  | 'AT_ORIGIN_WAREHOUSE'
  | 'IN_TRANSIT'
  | 'AT_DESTINATION_WAREHOUSE'
  | 'AWAITING_DELIVERY_ASSIGNMENT'
  | 'DELIVERY_ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RETURN_REQUESTED'
  | 'RETURN_IN_TRANSIT'
  | 'RETURNED'
  | 'CANCELLED'
  | 'DAMAGED'
  | 'LOST';

export type { ShippingFeePayer } from './shipping-fee-payer';
import type { ShippingFeePayer } from './shipping-fee-payer';

export type ShippingFeeTransactionStatus =
  | 'PENDING'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'COLLECTED'
  | 'REMITTED'
  | 'SETTLED'
  | 'DISPUTED'
  | 'CANCELLED';

export interface ShippingFeeTransaction {
  id: string;
  payer: ShippingFeePayer;
  expectedAmount: number;
  collectedAmount: number | null;
  remittedAmount: number | null;
  paidAmount: number | null;
  status: ShippingFeeTransactionStatus;
  collectedAt: string | null;
  remittedAt: string | null;
  settledAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
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
}

export interface PricingBreakdown {
  configVersion: number;
  baseFee: number;
  distanceFee: number;
  weightFee: number;
  codFee: number;
  surcharge: number;
  discount: number;
  totalFee: number;
}

export interface TrackingEvent {
  id: string;
  status: ShipmentStatus;
  type: string;
  title: string;
  description: string | null;
  createdAt: string;
}

export interface Shipment {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  sender: { fullName: string; email?: string; phone: string | null };
  receiver: { fullName: string; phone: string | null };
  pickup: AddressSnapshot;
  delivery: AddressSnapshot;
  package: PackageSnapshot;
  pricing: PricingBreakdown;
  codAmount: number;
  totalFee: number;
  shippingFeePayer: ShippingFeePayer;
  shippingFee: ShippingFeeTransaction;
  canCancel: boolean;
  cancellationReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  timeline: TrackingEvent[];
}

export interface ShipmentSummary {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  receiverName: string;
  deliveryCity: string;
  totalFee: number;
  codAmount: number;
  shippingFeePayer: ShippingFeePayer;
  shippingFee: ShippingFeeTransaction;
  createdAt: string;
}

export interface PaginatedShipments {
  items: ShipmentSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PublicTracking {
  trackingCode: string;
  status: ShipmentStatus;
  originCity: string;
  destinationCity: string;
  createdAt: string;
  timeline: TrackingEvent[];
}
