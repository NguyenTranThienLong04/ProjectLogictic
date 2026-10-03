import type { UserRole } from '../../types/auth';
import type { Notification } from './notification-api';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function notificationTarget(notification: Pick<Notification, 'type' | 'data'>, role?: UserRole): string | undefined {
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
