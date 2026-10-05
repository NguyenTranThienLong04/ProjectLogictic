import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { SelectField } from '../../components/ui/select-field';
import { ErrorState } from '../../components/ui/error-state';
import { getWarehouse, listWarehouses } from '../warehouses/warehouses-api';
import {
  shipmentStatusBadgeConfig,
  lineHaulTripStatusBadgeConfig,
} from '../../components/ui/status-badge-config';
import { localDateInput, slaLabels, stageLabels } from './control-tower-model';
import type { TowerFilters } from './control-tower-types';

function WarehouseFilter({ initialId }: { initialId: string }) {
  const [selected, setSelected] = useState(initialId);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const warehouses = useQuery({
    queryKey: ['tower-warehouses', search, page],
    queryFn: () => listWarehouses({ search, page, limit: 25 }),
    staleTime: 60000,
  });
  const selectedWarehouse = useQuery({
    queryKey: ['warehouse', selected],
    queryFn: () => getWarehouse(selected),
    enabled: Boolean(selected),
    staleTime: 60000,
  });
  return (
    <div className="space-y-2">
      <FormField
        id="tower-warehouse-search"
        label="Tìm kho theo mã / tên"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
        placeholder="Tìm trong danh mục kho"
      />
      <SelectField
        label="Kho liên quan"
        id="tower-warehouse"
        name="warehouseId"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">Tất cả kho</option>
        {selected && !warehouses.data?.items.some((warehouse) => warehouse.id === selected) ? (
          <option value={selected}>
            {selectedWarehouse.data
              ? `${selectedWarehouse.data.code} · ${selectedWarehouse.data.name}`
              : 'Kho đã chọn'}
          </option>
        ) : null}
        {warehouses.data?.items.map((warehouse) => (
          <option key={warehouse.id} value={warehouse.id}>
            {warehouse.code} · {warehouse.name}
          </option>
        ))}
      </SelectField>
      {warehouses.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Đang tải danh mục kho…
        </p>
      ) : null}
      {warehouses.isError ? (
        <ErrorState message="Không tải được danh mục kho." onRetry={() => warehouses.refetch()} />
      ) : null}
      {warehouses.data && warehouses.data.pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 1 || warehouses.isFetching}
            onClick={() => setPage(page - 1)}
          >
            Kho trước
          </Button>
          <span>
            {page} / {warehouses.data.pagination.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= warehouses.data.pagination.totalPages || warehouses.isFetching}
            onClick={() => setPage(page + 1)}
          >
            Kho tiếp
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ControlTowerFilters({
  params,
  options,
  onApply,
}: {
  params: URLSearchParams;
  options: TowerFilters;
  onApply: (next: URLSearchParams) => void;
}) {
  const [error, setError] = useState('');
  const statusLabels: Record<string, { label: string }> = {
    ...shipmentStatusBadgeConfig,
    ...lineHaulTripStatusBadgeConfig,
  };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const [key, value] of form)
      if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
    for (const key of ['from', 'to'])
      if (next.has(key)) next.set(key, new Date(next.get(key)!).toISOString());
    if (next.has('from') && next.has('to') && next.get('from')! >= next.get('to')!) {
      setError('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
      return;
    }
    next.set('sort', params.get('sort') ?? 'PRIORITY');
    next.set('limit', params.get('limit') ?? '25');
    next.set('page', '1');
    setError('');
    onApply(next);
  }
  return (
    <form
      className="rounded-surface border border-border bg-surface p-4 sm:p-5"
      onSubmit={submit}
      aria-label="Bộ lọc Control Tower"
    >
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-4">
          <FormField
            id="tower-search"
            label="Mã shipment / transfer / trip"
            name="search"
            maxLength={80}
            defaultValue={params.get('search') ?? ''}
            placeholder="Nhập mã cần tìm"
          />
          <SelectField
            label="Đối tượng"
            id="tower-entity"
            name="entityType"
            defaultValue={params.get('entityType') ?? 'ALL'}
          >
            <option value="ALL">Shipment và Trip</option>
            <option value="SHIPMENT">Shipment</option>
            <option value="TRIP">Line-haul Trip</option>
          </SelectField>
        </div>
        <WarehouseFilter initialId={params.get('warehouseId') ?? ''} />
        <div className="space-y-4">
          <SelectField
            label="SLA"
            id="tower-sla"
            name="slaState"
            defaultValue={params.get('slaState') ?? ''}
          >
            <option value="">Tất cả SLA</option>
            {options.slaStates.map((state) => (
              <option key={state} value={state}>
                {slaLabels[state] ?? state}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Trạng thái"
            id="tower-status"
            name="status"
            defaultValue={params.get('status') ?? ''}
          >
            <option value="">Tất cả trạng thái</option>
            {options.statuses.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]?.label ?? status}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="space-y-4">
          <FormField
            id="tower-from"
            name="from"
            label="Tạo từ (giờ thiết bị)"
            type="datetime-local"
            defaultValue={localDateInput(params.get('from'))}
          />
          <FormField
            id="tower-to"
            name="to"
            label="Tạo trước (giờ thiết bị)"
            type="datetime-local"
            defaultValue={localDateInput(params.get('to'))}
          />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <SelectField
          label="Stage"
          id="tower-stage"
          name="stage"
          defaultValue={params.get('stage') ?? ''}
        >
          <option value="">Tất cả stage</option>
          {options.stages.map((stage) => (
            <option key={stage} value={stage}>
              {stageLabels[stage] ?? stage}
            </option>
          ))}
        </SelectField>
        <label className="flex min-h-12 cursor-pointer items-center gap-2 text-sm font-semibold">
          <input
            className="size-4"
            type="checkbox"
            name="exceptionsOnly"
            value="true"
            defaultChecked={params.get('exceptionsOnly') === 'true'}
          />
          Chỉ exception chưa xử lý
        </label>
        <Button type="submit">Áp dụng bộ lọc</Button>
        <Button variant="ghost" onClick={() => onApply(new URLSearchParams())}>
          Xóa bộ lọc
        </Button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
