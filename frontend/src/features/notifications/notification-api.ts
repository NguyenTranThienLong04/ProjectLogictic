import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';

export interface Notification {
  id: string;
  eventKey: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: Notification[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unreadCount: number;
}

export async function listNotifications(
  page = 1,
  limit = 8,
  unreadOnly = false,
): Promise<NotificationList> {
  const response = await api.get<ApiEnvelope<NotificationList>>('/notifications', {
    params: { page, limit, unreadOnly },
  });
  return response.data.data;
}

export async function markAllNotificationsRead(): Promise<{
  markedCount: number;
  unreadCount: 0;
}> {
  const response = await api.patch<
    ApiEnvelope<{ markedCount: number; unreadCount: 0 }>
  >('/notifications/read-all');
  return response.data.data;
}

export async function markNotificationRead(notificationId: string): Promise<Notification> {
  const response = await api.patch<ApiEnvelope<Notification>>(
    `/notifications/${notificationId}/read`,
  );
  return response.data.data;
}
