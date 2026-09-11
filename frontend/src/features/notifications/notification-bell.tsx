import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dateTimeFormatter } from '../../utils/format';
import { getAccessToken } from '../../services/auth-session';
import { createOperationsSocket } from '../../services/operations-socket';
import { listNotifications, markNotificationRead } from './notification-api';

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [announcement, setAnnouncement] = useState('');
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications(),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const socket = createOperationsSocket();
    const refreshOperations = () => {
      void queryClient.invalidateQueries({ queryKey: ['driver-assignments'] });
      void queryClient.invalidateQueries({ queryKey: ['driver-deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['driver-dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['operational-shipments'] });
      void queryClient.invalidateQueries({ queryKey: ['available-drivers'] });
      void queryClient.invalidateQueries({ queryKey: ['shipment'] });
      void queryClient.invalidateQueries({ queryKey: ['shipments'] });
    };
    socket.on('connect', refreshOperations);
    socket.on('notification.created', (payload: { title?: string }) => {
      setAnnouncement(payload.title ?? 'Có thông báo mới');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      refreshOperations();
    });
    socket.on('assignment.created', refreshOperations);
    socket.on('shipment.updated', refreshOperations);
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <details className="group relative">
        <summary className="focus-ring ui-transition flex min-h-11 cursor-pointer list-none items-center rounded-control border border-border bg-surface px-3 text-sm font-semibold text-primary shadow-surface transition-colors hover:border-border-strong hover:bg-primary-soft">
          Thông báo
          {notifications.data?.unreadCount ? (
            <span
              aria-label={`${notifications.data.unreadCount} thông báo chưa đọc`}
              className="ml-2 min-w-6 rounded-full border border-orange-600 bg-orange-500 px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-slate-950"
            >
              {notifications.data.unreadCount > 99 ? '99+' : notifications.data.unreadCount}
            </span>
          ) : null}
        </summary>
        <section className="absolute right-0 z-40 mt-2 w-[min(23rem,calc(100vw-2rem))] rounded-overlay border border-border bg-surface p-3 shadow-floating">
          <Link
            className="focus-ring ui-transition mb-1 inline-flex min-h-11 items-center rounded-control px-2 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft"
            to="/notifications"
          >
            Xem tất cả thông báo
          </Link>
          <h2 className="px-2 py-2 font-semibold text-ink">Thông báo gần đây</h2>
          {notifications.isPending ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">Đang tải…</p>
          ) : notifications.isError ? (
            <button
              className="focus-ring ui-transition min-h-11 cursor-pointer rounded-control px-2 text-sm font-semibold text-danger transition-colors hover:bg-red-50"
              onClick={() => notifications.refetch()}
              type="button"
            >
              Không tải được — thử lại
            </button>
          ) : notifications.data?.items.length ? (
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {notifications.data.items.map((item) => (
                <li key={item.id}>
                  <button
                    aria-busy={markRead.isPending || undefined}
                    className={`focus-ring ui-transition min-h-11 w-full cursor-pointer rounded-control border p-3 text-left transition-colors hover:border-border-strong hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-45 ${item.readAt ? 'border-transparent text-muted-foreground' : 'border-blue-100 bg-blue-50 text-ink'}`}
                    disabled={markRead.isPending}
                    onClick={() => !item.readAt && markRead.mutate(item.id)}
                    type="button"
                  >
                    <span className="block text-sm font-semibold">{item.title}</span>
                    <span className="mt-1 block text-sm leading-5">{item.message}</span>
                    <span className="mt-2 block text-xs font-medium tabular-nums">
                      {dateTimeFormatter.format(new Date(item.createdAt))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-4 text-sm text-muted-foreground">Chưa có thông báo.</p>
          )}
        </section>
      </details>
    </>
  );
}
