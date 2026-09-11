import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { LoadingState } from '../../components/ui/loading-state';
import { SelectField } from '../../components/ui/select-field';
import { getApiErrorMessage } from '../../services/api-error';
import { formatRouteDistance, formatRouteDuration } from '../../utils/route-metric';
import { listWarehouses } from '../warehouses/warehouses-api';
import { CapacityIndicator } from './capacity-indicator';
import { getLineHaulPlanningRecommendations } from './line-haul-api';
import { formatCapacityWeight, lineHaulWarehouseLabel } from './line-haul-model';
import type { LineHaulPlanningRecommendation, LineHaulWarehouse } from './line-haul-types';

const planningSchema = z
  .object({
    originWarehouseId: z.uuid('Chọn kho xuất phát'),
    destinationWarehouseId: z.uuid('Chọn kho đích'),
    earliestStartAt: z.string().min(1, 'Chọn thời điểm bắt đầu sớm nhất'),
    latestEndAt: z.string().min(1, 'Chọn thời điểm kết thúc muộn nhất'),
  })
  .superRefine((values, context) => {
    if (values.originWarehouseId === values.destinationWarehouseId) {
      context.addIssue({
        code: 'custom',
        path: ['destinationWarehouseId'],
        message: 'Kho đích phải khác kho xuất phát',
      });
    }
    const earliest = new Date(values.earliestStartAt);
    const latest = new Date(values.latestEndAt);
    if (
      Number.isFinite(earliest.getTime()) &&
      Number.isFinite(latest.getTime()) &&
      latest.getTime() <= earliest.getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['latestEndAt'],
        message: 'Kết thúc muộn nhất phải sau bắt đầu sớm nhất',
      });
    }
  });

type PlanningForm = z.infer<typeof planningSchema>;

interface LineHaulPlanningPanelProps {
  onSelect: (recommendation: LineHaulPlanningRecommendation) => void;
  selectedRecommendation: LineHaulPlanningRecommendation | null;
}

export function LineHaulPlanningPanel({
  onSelect,
  selectedRecommendation,
}: LineHaulPlanningPanelProps) {
  const defaults = defaultPlanningRange();
  const warehouses = useQuery({
    queryKey: ['warehouses', 'line-haul-active'],
    queryFn: () => listWarehouses<LineHaulWarehouse>({ isActive: true, limit: 100 }),
  });
  const { control, formState, handleSubmit } = useForm<PlanningForm>({
    resolver: zodResolver(planningSchema),
    mode: 'onBlur',
    defaultValues: {
      originWarehouseId: '',
      destinationWarehouseId: '',
      earliestStartAt: defaults.earliest,
      latestEndAt: defaults.latest,
    },
  });
  const originWarehouseId = useWatch({ control, name: 'originWarehouseId' });
  const planning = useMutation({
    mutationFn: (values: PlanningForm) =>
      getLineHaulPlanningRecommendations({
        originWarehouseId: values.originWarehouseId,
        destinationWarehouseId: values.destinationWarehouseId,
        earliestStartAt: new Date(values.earliestStartAt).toISOString(),
        latestEndAt: new Date(values.latestEndAt).toISOString(),
        maxRecommendations: 5,
      }),
  });
  const destinationWarehouses =
    warehouses.data?.items.filter((warehouse) => warehouse.id !== originWarehouseId) ?? [];

  return (
    <section
      aria-labelledby="line-haul-planning-title"
      className="mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            G3C3 · Rule-based · advisory only
          </p>
          <h2 className="mt-2 text-xl font-semibold text-ink" id="line-haul-planning-title">
            Đề xuất kế hoạch
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Hệ thống xếp hạng từ tuyến, lịch rảnh, sức tải và manifest hiện tại. Dispatcher phải
            review rồi bấm dùng đề xuất; không có chuyến nào được tự tạo hoặc tự dispatch.
          </p>
        </div>
        <span className="w-fit rounded-full border border-blue-200 bg-primary-soft px-3 py-1 text-xs font-semibold text-primary-strong">
          Quyết định cuối: Dispatcher
        </span>
      </div>

      <form
        className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        noValidate
        onSubmit={handleSubmit((values) => planning.mutate(values))}
      >
        <div className="md:col-span-2 xl:col-span-4">
          <ErrorSummary
            message={planning.isError ? getApiErrorMessage(planning.error) : undefined}
          />
        </div>
        <Controller
          control={control}
          name="originWarehouseId"
          render={({ field }) => (
            <SelectField
              disabled={warehouses.isPending || planning.isPending}
              error={formState.errors.originWarehouseId?.message}
              id="planning-origin"
              label="Kho xuất phát"
              {...field}
            >
              <option value="">Chọn kho xuất phát</option>
              {warehouses.data?.items.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {lineHaulWarehouseLabel(warehouse)}
                </option>
              ))}
            </SelectField>
          )}
        />
        <Controller
          control={control}
          name="destinationWarehouseId"
          render={({ field }) => (
            <SelectField
              disabled={!originWarehouseId || warehouses.isPending || planning.isPending}
              error={formState.errors.destinationWarehouseId?.message}
              id="planning-destination"
              label="Kho đích"
              {...field}
            >
              <option value="">
                {originWarehouseId ? 'Chọn kho đích' : 'Chọn kho xuất phát trước'}
              </option>
              {destinationWarehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {lineHaulWarehouseLabel(warehouse)}
                </option>
              ))}
            </SelectField>
          )}
        />
        <Controller
          control={control}
          name="earliestStartAt"
          render={({ field }) => (
            <FormField
              disabled={planning.isPending}
              error={formState.errors.earliestStartAt?.message}
              id="planning-earliest-start"
              label="Bắt đầu sớm nhất"
              type="datetime-local"
              {...field}
            />
          )}
        />
        <Controller
          control={control}
          name="latestEndAt"
          render={({ field }) => (
            <FormField
              disabled={planning.isPending}
              error={formState.errors.latestEndAt?.message}
              id="planning-latest-end"
              label="Kết thúc muộn nhất"
              type="datetime-local"
              {...field}
            />
          )}
        />
        <div className="md:col-span-2 xl:col-span-4">
          <Button
            disabled={warehouses.isPending || warehouses.isError}
            loading={planning.isPending}
            type="submit"
          >
            {planning.isPending ? 'Đang tính đề xuất' : 'Xem đề xuất'}
          </Button>
        </div>
      </form>

      {warehouses.isError ? (
        <div className="mt-5">
          <ErrorState
            compact
            message="Không thể tải danh mục kho active."
            onRetry={() => warehouses.refetch()}
            title="Chưa thể lập tiêu chí"
          />
        </div>
      ) : null}
      {planning.isPending ? (
        <div className="mt-5">
          <LoadingState label="Đang kiểm tra route, lịch rảnh, sức tải và transfer" />
        </div>
      ) : null}
      {planning.isSuccess && planning.data.recommendations.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            compact
            description="Không có tổ hợp tài xế, xe, window và transfer cùng tuyến thỏa mọi điều kiện authoritative. Hãy đổi khoảng thời gian hoặc kiểm tra nguồn lực."
            title="Chưa có đề xuất hợp lệ"
          />
        </div>
      ) : null}
      {planning.data ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-border py-3 text-xs text-muted-foreground">
            <span>
              Thời lượng window:{' '}
              <strong className="text-ink">
                {planning.data.criteria.windowDurationMinutes} phút
              </strong>
            </span>
            <span>
              Transfer đủ điều kiện:{' '}
              <strong className="text-ink">{planning.data.criteria.eligibleTransferCount}</strong>
            </span>
            <span>
              Nguồn thời lượng:{' '}
              <strong className="text-ink">
                {planning.data.criteria.durationBasis === 'ROAD_ROUTE'
                  ? 'Duration đường bộ + 30 phút xử lý'
                  : 'Policy fallback 180 phút'}
              </strong>
            </span>
          </div>
          <ol className="mt-4 grid gap-4 xl:grid-cols-2">
            {planning.data.recommendations.map((recommendation) => {
              const selected = isSameRecommendation(selectedRecommendation, recommendation);
              return (
                <li
                  className={`rounded-surface border p-4 ${
                    selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface-subtle'
                  }`}
                  key={recommendationKey(recommendation)}
                >
                  <article aria-label={`Đề xuất hạng ${recommendation.rank}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
                          Hạng {recommendation.rank}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-ink">
                          {recommendation.driver.fullName} · {recommendation.driver.employeeCode}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {recommendation.vehicle.vehicleCode} ·{' '}
                          {recommendation.vehicle.licensePlate}
                        </p>
                      </div>
                      <span className="rounded-full border border-border-strong bg-surface px-3 py-1 font-mono text-sm font-bold tabular-nums text-ink">
                        {recommendation.score}/100
                      </span>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Departure window
                        </dt>
                        <dd className="mt-1 font-semibold tabular-nums text-ink">
                          {new Date(recommendation.scheduledStartAt).toLocaleString('vi-VN')}
                          <span className="block font-normal text-muted-foreground">
                            đến {new Date(recommendation.scheduledEndAt).toLocaleString('vi-VN')}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Tuyến dự kiến
                        </dt>
                        <dd className="mt-1 text-ink">
                          {recommendation.route ? (
                            <>
                              <span className="font-semibold">
                                {formatRouteDistance(recommendation.route.distanceMeters)}
                              </span>
                              <span className="block text-muted-foreground">
                                {recommendation.route.durationSeconds === null
                                  ? 'Không có ETA từ provider'
                                  : formatRouteDuration(recommendation.route.durationSeconds)}
                              </span>
                            </>
                          ) : (
                            'Kho chưa có đủ tọa độ; không có distance/ETA'
                          )}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4">
                      <CapacityIndicator
                        capacityUtilizationPercent={recommendation.capacityUtilizationPercent}
                        compact
                        manifestWeightGrams={recommendation.manifestWeightGrams}
                        remainingCapacityWeightGrams={recommendation.remainingCapacityWeightGrams}
                        vehicleCapacityWeightGrams={recommendation.vehicle.capacityWeightGrams}
                      />
                    </div>
                    <p className="mt-3 text-sm text-ink">
                      <strong>{recommendation.transfers.length} transfer:</strong>{' '}
                      {recommendation.transfers
                        .map(
                          (transfer) =>
                            `${transfer.transferCode} (${formatCapacityWeight(transfer.loadWeightGrams)})`,
                        )
                        .join(', ')}
                    </p>
                    <div className="mt-4 border-t border-border pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Lý do xếp hạng
                      </p>
                      <ul className="mt-2 space-y-1.5 text-sm text-ink">
                        {recommendation.reasons.map((reason) => (
                          <li className="flex items-start justify-between gap-3" key={reason.code}>
                            <span>{reason.label}</span>
                            <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-primary">
                              +{reason.points}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <Button
                      aria-pressed={selected}
                      className="mt-4 w-full sm:w-auto"
                      onClick={() => onSelect(recommendation)}
                      variant={selected ? 'secondary' : 'primary'}
                    >
                      {selected ? 'Đã điền vào Create Trip' : 'Dùng đề xuất này'}
                    </Button>
                  </article>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function recommendationKey(recommendation: LineHaulPlanningRecommendation): string {
  return `${recommendation.driver.id}:${recommendation.vehicle.id}:${recommendation.scheduledStartAt}`;
}

function isSameRecommendation(
  selected: LineHaulPlanningRecommendation | null,
  recommendation: LineHaulPlanningRecommendation,
): boolean {
  return selected !== null && recommendationKey(selected) === recommendationKey(recommendation);
}

function defaultPlanningRange(): { earliest: string; latest: string } {
  const earliest = new Date();
  earliest.setHours(earliest.getHours() + 1, 0, 0, 0);
  const latest = new Date(earliest.getTime() + 12 * 60 * 60_000);
  return { earliest: toLocalDateTimeValue(earliest), latest: toLocalDateTimeValue(latest) };
}

function toLocalDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
