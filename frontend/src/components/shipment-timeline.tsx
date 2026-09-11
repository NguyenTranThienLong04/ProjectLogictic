import type { TrackingEvent } from '../features/shipments/shipment-types';

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function ShipmentTimeline({ events }: { events: TrackingEvent[] }) {
  if (!events.length) {
    return (
      <p className="rounded-surface border border-dashed border-border-strong bg-surface-subtle px-4 py-5 text-sm text-muted-foreground">
        Chưa có cập nhật hành trình.
      </p>
    );
  }

  return (
    <ol className="space-y-0" aria-label="Dòng thời gian vận đơn">
      {events.map((event, index) => (
        <li className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0" key={event.id}>
          {index < events.length - 1 ? (
            <span aria-hidden="true" className="absolute bottom-0 left-[0.72rem] top-6 w-px bg-border-strong" />
          ) : null}
          <span aria-hidden="true" className="relative mt-1.5 size-6 rounded-full border-[5px] border-primary-soft bg-primary" />
          <div className="min-w-0">
            <h3 className="font-semibold text-ink">{event.title}</h3>
            {event.description ? <p className="mt-1 wrap-anywhere text-sm leading-6 text-muted-foreground">{event.description}</p> : null}
            <time className="mt-1.5 block text-xs font-medium tabular-nums text-muted-foreground" dateTime={event.createdAt}>
              {dateFormatter.format(new Date(event.createdAt))}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
