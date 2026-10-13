import type { UserRole } from '../../types/auth';
import type { Notification } from './notification-api';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const customerShipmentTypes = new Set([
  'SHIPMENT_CREATED',
  'SHIPMENT_CONFIRMED',
  'PICKUP_DRIVER_ASSIGNED',
  'PICKUP_IN_PROGRESS',
  'SHIPMENT_PICKED_UP',
  'WAREHOUSE_ARRIVED',
  'DELIVERY_DRIVER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RETURN_STARTED',
]);

export function notificationTarget(notification: Pick<Notification, 'type' | 'data'>, role?: UserRole): string | undefined {
  if (role === 'CUSTOMER') {
    const shipmentId = notification.data?.shipmentId;
    // CustomerRoutes owns /shipments/:id; task IDs belong to Driver routes only.
    return customerShipmentTypes.has(notification.type) && typeof shipmentId === 'string' && uuid.test(shipmentId)
      ? `/shipments/${shipmentId}`
      : '/shipments';
  }
  if (role !== 'DRIVER') return undefined;
  const assignmentId = notification.data?.assignmentId;
  const validId = typeof assignmentId === 'string' && uuid.test(assignmentId);
  if (notification.type === 'PICKUP_ASSIGNMENT_CREATED') {
    return validId ? `/driver/pickups/${assignmentId}` : '/driver/assignments';
  }
  if (notification.type === 'DELIVERY_ASSIGNMENT_CREATED') {
    return validId ? `/driver/deliveries/${assignmentId}` : '/driver/deliveries';
  }
  return '/driver/assignments';
}
