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
import { createPricingConfig, getPricingConfig, isPricingConfigUnavailable } from './pricing-api';

const schema = z.object({
  baseFee: z
    .number({ error: 'Vui lòng nhập phí cơ bản.' })
    .int('Nhập số nguyên VND.')
    .min(0, 'Phí không được âm.')
    .max(10_000_000, 'Phí tối đa 10.000.000 VND.'),
  includedWeightGrams: z
    .number({ error: 'Vui lòng nhập khối lượng.' })
    .int('Nhập số gram nguyên.')
    .min(1, 'Khối lượng tối thiểu 1 gram.')
    .max(100_000, 'Khối lượng tối đa 100.000 gram.'),
  extraWeightFeePerKg: z
    .number({ error: 'Vui lòng nhập phí vượt mức.' })
    .int('Nhập số nguyên VND.')
    .min(0, 'Phí không được âm.')
    .max(10_000_000, 'Phí tối đa 10.000.000 VND.'),
  codFeeBasisPoints: z
    .number({ error: 'Vui lòng nhập phí COD.' })
    .int('Nhập số basis points nguyên.')
    .min(0, 'Phí COD không được âm.')
    .max(10_000, 'Phí COD tối đa 10.000 basis points (100%).'),
});
type PricingConfigForm = z.infer<typeof schema>;

// Draft only, matching the approved Phase 2 migration policy. Never used as a quote fallback.
const initialPricingDraft: PricingConfigForm = {
  baseFee: 30_000,
  includedWeightGrams: 1_000,
  extraWeightFeePerKg: 5_000,
  codFeeBasisPoints: 50,
};

export function PricingConfigPage() {
  const queryClient = useQueryClient();
  const [successMessage, setSuccessMessage] = useState<string>();
  const [creatingFirstConfig, setCreatingFirstConfig] = useState(false);
  const configQuery = useQuery({
    queryKey: ['pricing-config'],
    queryFn: getPricingConfig,
    retry: false,
  });
  const noActiveConfig = configQuery.isError && isPricingConfigUnavailable(configQuery.error);
  const { formState, handleSubmit, register, reset, setFocus } = useForm<PricingConfigForm>({
    resolver: zodResolver(schema),
    mode: 'onChange',
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
  useEffect(() => {
    if (creatingFirstConfig) setFocus('baseFee');
  }, [creatingFirstConfig, setFocus]);
  const updateMutation = useMutation({
    mutationFn: createPricingConfig,
    onSuccess: (config) => {
      queryClient.setQueryData(['pricing-config'], config);
      setCreatingFirstConfig(false);
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
          description="Mỗi lần lưu tạo một phiên bản mới. Vận đơn cũ giữ nguyên mức phí tại thời điểm tạo."
          eyebrow="Quản trị · Chính sách giá"
          title="Cấu hình giá vận chuyển"
        />
        {configQuery.isError && !noActiveConfig ? (
          <div className="mt-6">
            <ErrorState
              title="Không thể tải cấu hình giá"
              message="Vui lòng thử lại. Nếu lỗi tiếp tục, hãy kiểm tra kết nối hoặc liên hệ bộ phận hỗ trợ."
              onRetry={() => configQuery.refetch()}
            />
          </div>
        ) : noActiveConfig && !creatingFirstConfig ? (
          <div className="mt-6">
            <EmptyState
              title="Chưa có cấu hình giá vận chuyển"
              description="Hệ thống chưa thể tính phí vận chuyển vì Admin chưa thiết lập bảng giá. Hãy tạo cấu hình giá đầu tiên để khách hàng có thể nhận báo giá và tạo vận đơn."
              action={
                <Button
                  onClick={() => {
                    reset(initialPricingDraft);
                    updateMutation.reset();
                    setSuccessMessage(undefined);
                    setCreatingFirstConfig(true);
                  }}
                >
                  Tạo cấu hình giá
                </Button>
              }
            />
            <p className="mt-3 text-center text-sm leading-6 text-muted-foreground">
              Sau khi kích hoạt cấu hình, chức năng báo giá và tạo vận đơn sẽ hoạt động.
            </p>
          </div>
        ) : configQuery.data || (noActiveConfig && creatingFirstConfig) ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6">
              <h2 className="text-lg font-semibold text-ink">
                {noActiveConfig ? 'Tạo cấu hình giá đầu tiên' : 'Tạo phiên bản tiếp theo'}
              </h2>
              {noActiveConfig ? (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Bảng giá được điền sẵn theo chính sách mặc định. Kiểm tra và bấm lưu để kích hoạt.
                </p>
              ) : null}
              <form className="mt-6 space-y-5" noValidate onSubmit={submit}>
                <ErrorSummary
                  message={
                    updateMutation.isError ? getApiErrorMessage(updateMutation.error) : undefined
                  }
                />
                {successMessage ? (
                  <p
                    aria-live="polite"
                    className="rounded-control border border-emerald-200 bg-success-soft p-4 text-sm font-semibold leading-6 text-emerald-900"
                  >
                    {successMessage}
                  </p>
                ) : null}
                <FormField
                  error={formState.errors.baseFee?.message}
                  helperText="Đơn vị VND, bao gồm khối lượng định mức."
                  id="pricing-base"
                  inputMode="numeric"
                  label="Phí cơ bản"
                  min="0"
                  type="number"
                  {...register('baseFee', { valueAsNumber: true })}
                />
                <FormField
                  error={formState.errors.includedWeightGrams?.message}
                  id="pricing-included-weight"
                  inputMode="numeric"
                  label="Khối lượng đã bao gồm (gram)"
                  min="1"
                  type="number"
                  {...register('includedWeightGrams', { valueAsNumber: true })}
                />
                <FormField
                  error={formState.errors.extraWeightFeePerKg?.message}
                  id="pricing-extra-weight"
                  inputMode="numeric"
                  label="Phí mỗi kg vượt mức"
                  min="0"
                  type="number"
                  {...register('extraWeightFeePerKg', { valueAsNumber: true })}
                />
                <FormField
                  error={formState.errors.codFeeBasisPoints?.message}
                  helperText="50 basis points = 0,5%. Kết quả COD được làm tròn lên tới đồng gần nhất."
                  id="pricing-cod-bps"
                  inputMode="numeric"
                  label="Phí COD (basis points)"
                  min="0"
                  type="number"
                  {...register('codFeeBasisPoints', { valueAsNumber: true })}
                />
                <p className="text-sm leading-6 text-muted-foreground">
                  Phí khoảng cách: 0 VND · Phụ phí: 0 VND · Giảm giá: 0 VND. Các khoản này hiện
                  không áp dụng.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    className="w-full sm:w-auto"
                    loading={updateMutation.isPending}
                    type="submit"
                  >
                    {noActiveConfig ? 'Lưu và kích hoạt' : 'Kích hoạt phiên bản mới'}
                  </Button>
                  {noActiveConfig ? (
                    <Button
                      disabled={updateMutation.isPending}
                      onClick={() => setCreatingFirstConfig(false)}
                      variant="secondary"
                    >
                      Hủy
                    </Button>
                  ) : null}
                </div>
              </form>
            </section>
            {configQuery.data ? (
              <aside className="rounded-surface border border-border-strong bg-primary-soft/50 p-5 lg:sticky lg:top-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-ink">Đang hoạt động</h2>
                  <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-on-primary">
                    v{configQuery.data.version}
                  </span>
                </div>
                <dl className="mt-5 space-y-4 text-sm">
                  <ConfigValue
                    label="Phí cơ bản"
                    value={vndFormatter.format(configQuery.data.baseFee)}
                  />
                  <ConfigValue
                    label="Khối lượng gồm sẵn"
                    value={`${configQuery.data.includedWeightGrams.toLocaleString('vi-VN')} gram`}
                  />
                  <ConfigValue
                    label="Phí kg vượt mức"
                    value={vndFormatter.format(configQuery.data.extraWeightFeePerKg)}
                  />
                  <ConfigValue
                    label="Phí COD"
                    value={`${(configQuery.data.codFeeBasisPoints / 100).toLocaleString('vi-VN')}%`}
                  />
                  <ConfigValue
                    label="Phí khoảng cách"
                    value={vndFormatter.format(configQuery.data.distanceFee)}
                  />
                  <ConfigValue
                    label="Phụ phí"
                    value={vndFormatter.format(configQuery.data.surcharge)}
                  />
                  <ConfigValue
                    label="Giảm giá"
                    value={vndFormatter.format(configQuery.data.discount)}
                  />
                </dl>
              </aside>
            ) : null}
          </div>
        ) : (
          <div className="mt-6">
            <ErrorState
              title="Không thể tải cấu hình giá"
              message="Vui lòng thử lại."
              onRetry={() => configQuery.refetch()}
            />
          </div>
        )}
      </div>
    </AccountLayout>
  );
}

function ConfigValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
