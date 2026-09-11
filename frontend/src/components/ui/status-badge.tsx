import type { HTMLAttributes } from 'react';
import {
  codStatusBadgeConfig,
  deliveryFailureReasonBadgeConfig,
  shipmentStatusBadgeConfig,
  lineHaulTripStatusBadgeConfig,
  lineHaulVehicleStatusBadgeConfig,
  shippingFeeStatusBadgeConfig,
  warehouseTransferStatusBadgeConfig,
} from './status-badge-config';
import type {
  CodBadgeStatus,
  DeliveryFailureReasonBadgeStatus,
  ShipmentBadgeStatus,
  LineHaulTripBadgeStatus,
  LineHaulVehicleBadgeStatus,
  ShippingFeeBadgeStatus,
  StatusBadgeAppearance,
  WarehouseTransferBadgeStatus,
} from './status-badge-config';

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  appearance: StatusBadgeAppearance;
}

export function StatusBadge({ appearance, className = '', ...props }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold leading-4 ${appearance.surface} ${className}`}
      {...props}
    >
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${appearance.dot}`} />
      <span className="min-w-0">{appearance.label}</span>
    </span>
  );
}

export function ShipmentStatusBadge({ status }: { status: ShipmentBadgeStatus }) {
  return <StatusBadge appearance={shipmentStatusBadgeConfig[status]} />;
}

export function WarehouseTransferStatusBadge({
  status,
}: {
  status: WarehouseTransferBadgeStatus;
}) {
  return <StatusBadge appearance={warehouseTransferStatusBadgeConfig[status]} />;
}

export function CodStatusBadge({ status }: { status: CodBadgeStatus }) {
  return <StatusBadge appearance={codStatusBadgeConfig[status]} />;
}

export function ShippingFeeStatusBadge({ status }: { status: ShippingFeeBadgeStatus }) {
  return <StatusBadge appearance={shippingFeeStatusBadgeConfig[status]} />;
}

export function DeliveryFailureReasonBadge({
  reason,
}: {
  reason: DeliveryFailureReasonBadgeStatus;
}) {
  return <StatusBadge appearance={deliveryFailureReasonBadgeConfig[reason]} />;
}

export function LineHaulVehicleStatusBadge({
  status,
}: {
  status: LineHaulVehicleBadgeStatus;
}) {
  return <StatusBadge appearance={lineHaulVehicleStatusBadgeConfig[status]} />;
}

export function LineHaulTripStatusBadge({ status }: { status: LineHaulTripBadgeStatus }) {
  return <StatusBadge appearance={lineHaulTripStatusBadgeConfig[status]} />;
}
