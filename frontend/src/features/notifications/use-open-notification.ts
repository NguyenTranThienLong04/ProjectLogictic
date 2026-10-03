import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { markNotificationRead, type Notification } from './notification-api';
import { notificationTarget } from './notification-target';

export function useOpenNotification(onOpened?: () => void) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notification: Notification) => {
      if (!notification.readAt) await markNotificationRead(notification.id);
      return notification;
    },
    onSuccess: (notification) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      onOpened?.();
      const target = notificationTarget(notification, user?.role);
      if (target) navigate(target);
    },
  });
}
