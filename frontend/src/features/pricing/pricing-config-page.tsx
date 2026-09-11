import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { createPricingConfig, getPricingConfig } from './pricing-api';

const schema = z.object({
  baseFee: z.number().int().min(0).max(10_000_000),
  includedWeightGrams: z.number().int().min(1).max(100_000),
  extraWeightFeePerKg: z.number().int().min(0).max(10_000_000),
  codFeeBasisPoints: z.number().int().min(0).max(10_000),
});
type PricingConfigForm = z.infer<typeof schema>;

export function PricingConfigPage() {
  const queryClient = useQueryClient();
  const [successMessage, setSuccessMessage] = useState<string>();
  const configQuery = useQuery({ queryKey: ['pricing-config'], queryFn: getPricingConfig });
  const { formState, handleSubmit, register, reset } = useForm<PricingConfigForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
  });
  useEffect(() => {
    if (configQuery.data) {
      reset({
        baseFee: configQuery.data.baseFee,
        includedWeightGrams: configQuery.data.includedWeightGrams,
        extraWeightFeePerKg: configQuery.data.extraWeightFeePerKg,
        codFeeBasisPoints: configQuery.data.codFeeBasisPoints,
      });
    }
  }, [configQuery.data, reset]);
  const updateMutation = useMutation({
    mutationFn: createPricingConfig,
    onSuccess: (config) => {
      queryClient.setQueryData(['pricing-config'], config);
      setSuccessMessage(`Đã kích hoạt bảng giá phiên bản ${config.version}.`);
    },
  });
  const submit = handleSubmit((values) => {
    setSuccessMessage(undefined);
    updateMutation.mutate(values);
  });

  if (configQuery.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải cấu hình giá" />
      </AccountLayout>
    );
  }

  return (
    <AccountLayout>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          description="Mỗi lần lưu tạo một phiên bản mới. Vận đơn cũ tiếp tục dùng pricing snapshot tại thời điểm tạo."
          eyebrow="Quản trị · Chính sách giá"
          title="Cấu hình giá vận chuyển"
        />
        {configQuery.isError ? (
          <div className="mt-6">
            <ErrorState
              message={getApiErrorMessage(configQuery.error)}
              onRetry={() => configQuery.refetch()}
            />
          </div>
        ) : configQuery.data ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6">
              <h2 className="text-lg font-semibold text-ink">Tạo phiên bản tiếp theo</h2>
              <form className="mt-6 space-y-5" noValidate onSubmit={submit}>
                <ErrorSummary message={updateMutation.isError ? getApiErrorMessage(updateMutation.error) : undefined} />
                {successMessage ? <p aria-live="polite" className="rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold leading-6 text-emerald-900">{successMessage}</p> : null}
                <FormField error={formState.errors.baseFee?.message} helperText="Đơn vị VND, bao gồm khối lượng định mức." id="pricing-base" inputMode="numeric" label="Phí cơ bản" min="0" type="number" {...register('baseFee', { valueAsNumber: true })} />
                <FormField error={formState.errors.includedWeightGrams?.message} id="pricing-included-weight" inputMode="numeric" label="Khối lượng đã bao gồm (gram)" min="1" type="number" {...register('includedWeightGrams', { valueAsNumber: true })} />
                <FormField error={formState.errors.extraWeightFeePerKg?.message} id="pricing-extra-weight" inputMode="numeric" label="Phí mỗi kg vượt mức" min="0" type="number" {...register('extraWeightFeePerKg', { valueAsNumber: true })} />
                <FormField error={formState.errors.codFeeBasisPoints?.message} helperText="50 basis points = 0,5%. Kết quả COD được làm tròn lên tới đồng gần nhất." id="pricing-cod-bps" inputMode="numeric" label="Phí COD (basis points)" min="0" type="number" {...register('codFeeBasisPoints', { valueAsNumber: true })} />
                <Button className="w-full sm:w-auto" loading={updateMutation.isPending} type="submit">Kích hoạt phiên bản mới</Button>
              </form>
            </section>
            <aside className="rounded-surface border border-border-strong bg-primary-soft/50 p-5 lg:sticky lg:top-6">
              <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-ink">Đang hoạt động</h2><span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-on-primary">v{configQuery.data.version}</span></div>
              <dl className="mt-5 space-y-4 text-sm">
                <ConfigValue label="Phí cơ bản" value={vndFormatter.format(configQuery.data.baseFee)} />
                <ConfigValue label="Khối lượng gồm sẵn" value={`${configQuery.data.includedWeightGrams.toLocaleString('vi-VN')} gram`} />
                <ConfigValue label="Phí kg vượt mức" value={vndFormatter.format(configQuery.data.extraWeightFeePerKg)} />
                <ConfigValue label="Phí COD" value={`${(configQuery.data.codFeeBasisPoints / 100).toLocaleString('vi-VN')}%`} />
                <ConfigValue label="Khoảng cách / phụ phí / giảm giá" value="0 VND — khóa ở Phase 2" />
              </dl>
            </aside>
          </div>
        ) : (
          <div className="mt-6">
            <EmptyState
              description="Hệ thống chưa trả về cấu hình giá đang hoạt động."
              title="Chưa có cấu hình giá"
            />
          </div>
        )}
      </div>
    </AccountLayout>
  );
}

function ConfigValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="font-semibold text-muted-foreground">{label}</dt><dd className="mt-1 font-bold tabular-nums text-ink">{value}</dd></div>;
}
