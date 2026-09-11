import {
  DriverAssignmentStatus,
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
  ShipmentStatus,
  type Prisma,
  type ShipmentProof,
} from '../../generated/prisma/client.js';
import type { AddressSnapshot, ContactSnapshot } from '../shipments/shipment.response.js';
import {
  toShippingFeeTransactionResponse,
  type ShippingFeeTransactionResponse,
} from '../shipping-fees/shipping-fee.response.js';
import {
  toAddressTaskLocation,
  type DriverTaskLocationResponse,
} from './task-location.response.js';

export type AssignmentWithDetails = Prisma.DriverAssignmentGetPayload<{
  include: {
    shipment: { include: { shippingFeeTransaction: true } };
    driver: { include: { user: true } };
    proof: true;
  };
}>;

export interface AssignmentResponse {
  id: string;
  shipmentId: string;
  trackingCode: string;
  shipmentStatus: ShipmentStatus;
  status: AssignmentWithDetails['status'];
  type: AssignmentWithDetails['type'];
  driver: {
    id: string;
    fullName: string;
    employeeCode: string;
    vehicleType: string;
    vehiclePlate: string;
  };
  pickup: AddressSnapshot;
  taskLocation: DriverTaskLocationResponse;
  receiver: ContactSnapshot;
  shippingFee: ShippingFeeTransactionResponse;
  availableActions: { collectShippingFee: boolean };
  assignedAt: Date;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  reason: string | null;
  proof: ProofResponse | null;
}

export interface ProofResponse {
  id: string;
  shipmentId: string;
  type: ShipmentProof['type'];
  note: string | null;
  fileUrl: string | null;
  capturedAt: Date;
  createdById: string;
}

export function toAssignmentResponse(assignment: AssignmentWithDetails): AssignmentResponse {
  const pickup = assignment.shipment.pickupSnapshot as unknown as AddressSnapshot;
  const shippingFee = assignment.shipment.shippingFeeTransaction;
  if (!shippingFee) throw new Error('Shipping fee snapshot is missing for this shipment');
  return {
    id: assignment.id,
    shipmentId: assignment.shipmentId,
    trackingCode: assignment.shipment.trackingCode,
    shipmentStatus: assignment.shipment.status,
    status: assignment.status,
    type: assignment.type,
    driver: {
      id: assignment.driver.id,
      fullName: assignment.driver.user.fullName,
      employeeCode: assignment.driver.employeeCode,
      vehicleType: assignment.driver.vehicleType,
      vehiclePlate: assignment.driver.vehiclePlate,
    },
    pickup,
    taskLocation: toAddressTaskLocation(
      'PICKUP',
      pickup.contactName ? `Điểm lấy hàng · ${pickup.contactName}` : 'Điểm lấy hàng',
      pickup,
    ),
    receiver: assignment.shipment.receiverSnapshot as unknown as ContactSnapshot,
    shippingFee: toShippingFeeTransactionResponse(shippingFee),
    availableActions: {
      collectShippingFee:
        shippingFee.payer === ShippingFeePayer.SENDER &&
        shippingFee.status === ShippingFeeTransactionStatus.PENDING &&
        assignment.status === DriverAssignmentStatus.ACCEPTED &&
        assignment.shipment.status === ShipmentStatus.PICKUP_IN_PROGRESS,
    },
    assignedAt: assignment.assignedAt,
    acceptedAt: assignment.acceptedAt,
    rejectedAt: assignment.rejectedAt,
    completedAt: assignment.completedAt,
    cancelledAt: assignment.cancelledAt,
    reason: assignment.reason,
    proof: assignment.proof ? toProofResponse(assignment.proof) : null,
  };
}

export function toProofResponse(proof: ShipmentProof): ProofResponse {
  return {
    id: proof.id,
    shipmentId: proof.shipmentId,
    type: proof.type,
    note: proof.note,
    fileUrl: proof.fileUrl,
    capturedAt: proof.capturedAt,
    createdById: proof.createdById,
  };
}
