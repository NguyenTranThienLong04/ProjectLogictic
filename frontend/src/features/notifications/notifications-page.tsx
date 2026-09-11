import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notification-api';

const pageSize = 12;

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const notifications = useQuery({
    queryKey: ['notifications', { page, unreadOnly }],
    queryFn: () => listNotifications(page, pageSize, unreadOnly),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: async () => {
      setAnnouncement('Đã đánh dấu thông báo là đã đọc.');
      await refresh();
    },
  });
  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async ({ markedCount }) => {
      setAnnouncement(`Đã đánh dấu ${markedCount} thông báo là đã đọc.`);
      await refresh();
    },
  });
  const mutationError = markRead.isError
    ? getApiErrorMessage(markRead.error)
    : markAllRead.isError
      ? getApiErrorMessage(markAllRead.error)
      : undefined;

  return (
    <AccountLayout>
      <section className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          actions={(
            <Button
              className="w-full sm:w-auto"
              disabled={!notifications.data?.unreadCount || markRead.isPending}
              loading={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
              variant="secondary"
            >
              Đánh dấu tất cả đã đọc
            </Button>
          )}
          description="Theo dõi cập nhật vận đơn và nhiệm vụ mới nhất từ một nơi."
          eyebrow="Notification Center"
          title="Thông báo của bạn"
        />

        {announcement ? (
          <p
            aria-atomic="true"
            aria-live="polite"
            className="rounded-control border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success"
          >
            {announcement}
          </p>
        ) : null}
        {mutationError ? <ErrorSummary message={mutationError} /> : null}

        <div className="flex flex-col gap-3 rounded-surface border border-border bg-surface p-3 shadow-surface sm:flex-row sm:items-center sm:justify-between">
          <div aria-label="Lọc thông báo" className="grid grid-cols-2 gap-2 sm:flex" role="group">
            {[
              { label: 'Tất cả', value: false },
              { label: 'Chưa đọc', value: true },
            ].map((filter) => (
              <button
                aria-pressed={unreadOnly === filter.value}
                className={`focus-ring ui-transition min-h-11 cursor-pointer rounded-control px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  unreadOnly === filter.value
                    ? 'bg-primary text-on-primary'
                    : 'text-muted-foreground hover:bg-primary-soft hover:text-primary'
                }`}
                disabled={notifications.isFetching}
                key={filter.label}
                onClick={() => {
                  setUnreadOnly(filter.value);
                  setPage(1);
                }}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {notifications.data
              ? `${notifications.data.unreadCount} thông báo chưa đọc`
              : 'Đang cập nhật số lượng'}
          </p>
        </div>

        {notifications.isPending ? (
          <LoadingState label="Đang tải thông báo" />
        ) : notifications.isError ? (
          <ErrorState
            message={getApiErrorMessage(notifications.error)}
            onRetry={() => notifications.refetch()}
            title="Không thể tải thông báo"
          />
        ) : notifications.data.items.length === 0 ? (
          <EmptyState
            description="Các cập nhật vận đơn và nhiệm vụ sẽ xuất hiện tại đây."
            title={unreadOnly ? 'Không còn thông báo chưa đọc' : 'Chưa có thông báo'}
          />
        ) : (
          <ul className="space-y-3">
            {notifications.data.items.map((item) => (
              <li
                className={`rounded-surface border shadow-surface ${
                  item.readAt ? 'border-border bg-surface' : 'border-border-strong bg-primary-soft'
                }`}
                key={item.id}
              >
                <article className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 max-w-prose">
                    <div className="flex flex-wrap items-center gap-2">
                      {!item.readAt ? (
                        <span className="rounded-badge bg-primary px-2.5 py-1 text-xs font-semibold text-on-primary">
                          Chưa đọc
                        </span>
                      ) : null}
                      <time
                        className="text-sm font-medium text-muted-foreground"
                        dateTime={item.createdAt}
                      >
                        {dateTimeFormatter.format(new Date(item.createdAt))}
                      </time>
                    </div>
                    <h2 className="mt-3 text-base font-semibold text-ink sm:text-lg">{item.title}</h2>
                    <p className="mt-1 leading-7 text-muted-foreground">{item.message}</p>
                  </div>
                  {!item.readAt ? (
                    <Button
                      className="w-full shrink-0 sm:w-auto"
                      disabled={markRead.isPending || markAllRead.isPending}
                      onClick={() => markRead.mutate(item.id)}
                      variant="secondary"
                    >
                      Đánh dấu đã đọc
                    </Button>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        )}

        {notifications.data && notifications.data.totalPages > 1 ? (
          <div className="rounded-surface border border-border bg-surface p-4 shadow-surface">
            <Pagination
              disabled={notifications.isFetching}
              label="Phân trang thông báo"
              onPageChange={setPage}
              page={page}
              totalPages={notifications.data.totalPages}
            />
          </div>
        ) : null}
      </section>
    </AccountLayout>
  );
}
