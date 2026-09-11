import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { LoadingState } from '../../components/ui/loading-state';
import { getApiErrorMessage } from '../../services/api-error';
import {
  getLineHaulResourceAvailability,
  rescheduleLineHaulTrip,
  scheduleLineHaulTrip,
  unscheduleLineHaulTrip,
} from './line-haul-api';
import {
  toIsoScheduleWindow,
  toLocalDateTimeInputValue,
} from './line-haul-schedule';
import type {
  LineHaulDriverAvailability,
  LineHaulResourceAvailabilityState,
  LineHaulTrip,
  LineHaulVehicleAvailability,
} from './line-haul-types';

interface LineHaulSchedulePanelProps {
  trip: LineHaulTrip;
  onUpdated: (trip: LineHaulTrip, message: string) => Promise<void>;
}

export function LineHaulSchedulePanel({ trip, onUpdated }: LineHaulSchedulePanelProps) {
  const [startValue, setStartValue] = useState(() =>
    toLocalDateTimeInputValue(trip.scheduledStartAt),
  );
  const [endValue, setEndValue] = useState(() =>
    toLocalDateTimeInputValue(trip.scheduledEndAt),
  );
  const [fieldError, setFieldError] = useState('');
  const [confirmUnschedule, setConfirmUnschedule] = useState(false);
  const window = toIsoScheduleWindow(startValue, endValue);

  const availability = useQuery({
    queryKey: [
      'line-haul-resource-availability',
      trip.id,
      window?.scheduledStartAt,
      window?.scheduledEndAt,
    ],
    queryFn: () =>
      getLineHaulResourceAvailability({
        tripId: trip.id,
        scheduledStartAt: window!.scheduledStartAt,
        scheduledEndAt: window!.scheduledEndAt,
      }),
    enabled: trip.status === 'PLANNED' && window !== null,
  });

  const finishMutation = async (updated: LineHaulTrip, message: string) => {
    setConfirmUnschedule(false);
    setStartValue(toLocalDateTimeInputValue(updated.scheduledStartAt));
    setEndValue(toLocalDateTimeInputValue(updated.scheduledEndAt));
    setFieldError('');
    await onUpdated(updated, message);
  };
  const scheduleMutation = useMutation({
    mutationFn: scheduleLineHaulTrip,
    onSuccess: (updated) => finishMutation(updated, `Đã lên lịch chuyến ${updated.tripCode}.`),
  });
  const rescheduleMutation = useMutation({
    mutationFn: rescheduleLineHaulTrip,
    onSuccess: (updated) => finishMutation(updated, `Đã đổi lịch chuyến ${updated.tripCode}.`),
  });
  const unscheduleMutation = useMutation({
    mutationFn: unscheduleLineHaulTrip,
    onSuccess: (updated) =>
      finishMutation(updated, `Đã gỡ lịch ${updated.tripCode}; reservation đã được giải phóng.`),
  });
  const mutationError =
    scheduleMutation.error ?? rescheduleMutation.error ?? unscheduleMutation.error;
  const pending =
    scheduleMutation.isPending || rescheduleMutation.isPending || unscheduleMutation.isPending;
  const assignedDriver = availability.data?.drivers.find((driver) => driver.id === trip.driverId);
  const assignedVehicle = availability.data?.vehicles.find(
    (vehicle) => vehicle.id === trip.vehicleId,
  );
  const assignedResourcesAvailable =
    assignedDriver?.availability === 'AVAILABLE' && assignedVehicle?.availability === 'AVAILABLE';

  const submit = () => {
    if (!startValue || !endValue) {
      setFieldError('Chọn đầy đủ thời gian bắt đầu và kết thúc.');
      return;
    }
    if (!window) {
      setFieldError('Thời gian kết thúc phải sau thời gian bắt đầu.');
      return;
    }
    setFieldError('');
    const payload = { tripId: trip.id, expectedVersion: trip.version, ...window };
    if (trip.availableActions.reschedule) rescheduleMutation.mutate(payload);
    else scheduleMutation.mutate(payload);
  };

  return (
    <section
      aria-labelledby="line-haul-schedule-title"
      className="mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface"
    >
      <div>
        <h2 className="text-lg font-semibold text-ink" id="line-haul-schedule-title">
          Lịch tài xế và xe
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Window dùng biên [bắt đầu, kết thúc), nên hai chuyến liền nhau không bị coi là trùng lịch.
        </p>
      </div>

      <ErrorSummary message={mutationError ? getApiErrorMessage(mutationError) : undefined} />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <FormField
          disabled={pending || trip.status !== 'PLANNED'}
          error={fieldError || undefined}
          helperText="Ngày và giờ xe dự kiến bắt đầu chạy tuyến."
          id="line-haul-scheduled-start"
          label="Bắt đầu"
          min="2000-01-01T00:00"
          onChange={(event) => {
            setStartValue(event.target.value);
            setFieldError('');
          }}
          type="datetime-local"
          value={startValue}
        />
        <FormField
          disabled={pending || trip.status !== 'PLANNED'}
          error={fieldError || undefined}
          helperText="Phải sau thời gian bắt đầu."
          id="line-haul-scheduled-end"
          label="Kết thúc"
          min={startValue || '2000-01-01T00:00'}
          onChange={(event) => {
            setEndValue(event.target.value);
            setFieldError('');
          }}
          type="datetime-local"
          value={endValue}
        />
      </div>

      {window ? (
        availability.isPending ? (
          <div className="mt-4">
            <LoadingState compact label="Đang kiểm tra lịch tài xế và xe" />
          </div>
        ) : availability.isError ? (
          <div className="mt-4">
            <ErrorState
              compact
              message={getApiErrorMessage(availability.error)}
              onRetry={() => availability.refetch()}
              title="Chưa kiểm tra được lịch nguồn lực"
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <AvailabilityList
              assignedId={trip.driverId}
              items={availability.data?.drivers ?? []}
              title="Tài xế theo window"
            />
            <AvailabilityList
              assignedId={trip.vehicleId}
              items={availability.data?.vehicles ?? []}
              title="Xe theo window"
            />
          </div>
        )
      ) : (
        <p className="mt-4 rounded-control border border-border bg-surface-subtle px-4 py-3 text-sm text-muted-foreground">
          Chọn window hợp lệ để xem nguồn lực rảnh hoặc bận.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {trip.availableActions.schedule || trip.availableActions.reschedule ? (
          <Button
            className="w-full sm:w-auto"
            disabled={pending || availability.isPending || !assignedResourcesAvailable}
            loading={scheduleMutation.isPending || rescheduleMutation.isPending}
            onClick={submit}
          >
            {trip.availableActions.reschedule ? 'Đổi lịch' : 'Lên lịch'}
          </Button>
        ) : null}
        {trip.availableActions.unschedule ? (
          <Button
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={() => setConfirmUnschedule(true)}
            variant="secondary"
          >
            Gỡ lịch
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        confirmLabel="Gỡ lịch"
        description="Window sẽ được xóa và tài xế/xe được giải phóng khỏi reservation này. Trip và manifest vẫn được giữ."
        loading={unscheduleMutation.isPending}
        onCancel={() => !unscheduleMutation.isPending && setConfirmUnschedule(false)}
        onConfirm={() =>
          unscheduleMutation.mutate({ tripId: trip.id, expectedVersion: trip.version })
        }
        open={confirmUnschedule}
        title="Xác nhận gỡ lịch chuyến"
      />
    </section>
  );
}

type AvailabilityItem = LineHaulDriverAvailability | LineHaulVehicleAvailability;

function AvailabilityList({
  assignedId,
  items,
  title,
}: {
  assignedId: string;
  items: AvailabilityItem[];
  title: string;
}) {
  return (
    <div className="min-w-0 rounded-control border border-border bg-surface-subtle p-4">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Không có nguồn lực phù hợp.</p>
      ) : (
        <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
          {items.map((item) => {
            const label =
              'employeeCode' in item
                ? `${item.employeeCode} · ${item.fullName}`
                : `${item.vehicleCode} · ${item.licensePlate}`;
            return (
              <li
                className={`rounded-control border px-3 py-2 text-sm ${
                  item.id === assignedId ? 'border-primary bg-blue-50' : 'border-border bg-surface'
                }`}
                key={item.id}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <span className="wrap-anywhere font-semibold text-ink">
                    {label}
                    {item.id === assignedId ? ' · Đã gán' : ''}
                  </span>
                  <AvailabilityLabel state={item.availability} />
                </div>
                {item.unavailableReason ? (
                  <p className="mt-1 text-xs leading-5 text-danger">{item.unavailableReason}</p>
                ) : item.conflicts[0] ? (
                  <p className="mt-1 text-xs leading-5 tabular-nums text-muted-foreground">
                    Trùng {item.conflicts[0].tripCode}
                    {item.conflicts[0].scheduledStartAt && item.conflicts[0].scheduledEndAt
                      ? ` · ${new Date(item.conflicts[0].scheduledStartAt).toLocaleString('vi-VN')} – ${new Date(item.conflicts[0].scheduledEndAt).toLocaleString('vi-VN')}`
                      : ' · chuyến đang thực hiện'}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AvailabilityLabel({ state }: { state: LineHaulResourceAvailabilityState }) {
  const label = state === 'AVAILABLE' ? 'Rảnh' : state === 'BUSY' ? 'Bận' : 'Không khả dụng';
  const tone =
    state === 'AVAILABLE'
      ? 'border-emerald-300 bg-emerald-100 text-emerald-900'
      : state === 'BUSY'
        ? 'border-orange-300 bg-orange-100 text-orange-900'
        : 'border-slate-300 bg-slate-100 text-slate-700';
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${tone}`}>
      {label}
    </span>
  );
}
