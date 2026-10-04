import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { markNotificationRead, type Notification } from './notification-api';
import { notificationTarget } from './notification-target';

export function useOpenNotification(onOpened?: () => void) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutationKey = ['notifications', 'open', user?.id];
  // Keep read failures visible in the destination layout after the center unmounts.
  const errors = useMutationState({
    filters: { mutationKey, exact: true },
    select: (mutation) => mutation.state.status === 'error' ? mutation.state.error : null,
  });
  const markRead = useMutation({
    mutationKey,
    mutationFn: async (notification: Notification) => {
      if (!notification.readAt) await markNotificationRead(notification.id);
      return notification;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const error = errors.at(-1) ?? null;
  return {
    error,
    isError: error !== null,
    mutate: (notification: Notification) => {
      // Navigation must not depend on the read request, including a stalled request.
      markRead.mutate(notification);
      onOpened?.();
      const target = notificationTarget(notification, user?.role);
      if (target) navigate(target);
    },
  };
}
