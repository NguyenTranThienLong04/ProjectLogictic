import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { listAddresses } from '../addresses/address-api';
import { AccountLayout } from '../auth/components/account-layout';
import { getQuote } from '../pricing/pricing-api';
import { PriceBreakdown } from '../pricing/price-breakdown';
import { createShipment } from './shipment-api';
import {
  deliverySnapshot,
  quoteInput,
  quoteSignature,
  shipmentFormDefaults,
  shipmentFormSchema,
  type ShipmentFormValues,
} from './shipment-form';
import { ShipmentFormFields } from './shipment-form-fields';
import { ShippingFeeResponsibilityCard } from './shipping-fee-responsibility-card';

export function CreateShipmentPage() {
  const navigate = useNavigate();
  const addressesQuery = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [quotedSignature, setQuotedSignature] = useState<string>();
  const { control, formState, handleSubmit, register, setValue } = useForm<ShipmentFormValues>({
    resolver: zodResolver(shipmentFormSchema),
    mode: 'onBlur',
    defaultValues: shipmentFormDefaults,
  });
  const currentValues = useWatch({ control });
  const currentSignature = quoteSignature(currentValues);
  const quoteMutation = useMutation({
    mutationFn: ({ input }: { input: Parameters<typeof getQuote>[0]; signature: string }) =>
      getQuote(input),
    onSuccess: (_pricing, variables) => setQuotedSignature(variables.signature),
  });
  const createMutation = useMutation({
    mutationFn: createShipment,
    onSuccess: (shipment) => navigate(`/shipments/${shipment.id}`, { replace: true }),
  });

  const calculate = handleSubmit((values) => {
    const pickup = addressesQuery.data?.find((address) => address.id === values.pickupAddressId);
    if (pickup) {
      quoteMutation.mutate({
        input: quoteInput(values, pickup),
        signature: quoteSignature(values),
      });
    }
  });
  const submit = handleSubmit((values) => {
    if (quotedSignature !== currentSignature) return;
    createMutation.mutate({
      clientRequestId,
      pickupAddressId: values.pickupAddressId,
      deliveryAddress: deliverySnapshot(values),
      package: {
        description: values.description,
        packageType: values.packageType,
        weightGrams: values.weightGrams,
        lengthCm: values.lengthCm,
        widthCm: values.widthCm,
        heightCm: values.heightCm,
      },
      codAmount: values.codAmount,
      shippingFeePayer: values.shippingFeePayer,
    });
  });

  if (addressesQuery.isPending) return <LoadingState label="Đang chuẩn bị biểu mẫu vận đơn" />;

  const quoteIsCurrent = Boolean(quoteMutation.data && quotedSignature === currentSignature);

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Hoàn thành ba nhóm thông tin, kiểm tra báo giá rồi xác nhận tạo vận đơn."
          eyebrow="Tạo vận đơn"
          meta={
            <p className="text-sm font-medium text-primary" aria-label="Tiến trình biểu mẫu">
              4 bước: Địa chỉ → Kiện hàng → Người chịu phí → Xác nhận
            </p>
          }
          title="Gửi một kiện hàng mới"
        />

        {addressesQuery.isError ? (
          <div className="mt-8">
            <ErrorState
              message={getApiErrorMessage(addressesQuery.error)}
              onRetry={() => addressesQuery.refetch()}
              title="Không thể chuẩn bị biểu mẫu vận đơn"
            />
          </div>
        ) : (
          <form className="mt-6 grid min-w-0 gap-6 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start" noValidate onSubmit={submit}>
            <div className="min-w-0">
              <ShipmentFormFields
                control={control} setValue={setValue}
                addresses={addressesQuery.data ?? []} errors={formState.errors} register={register} />
              <div className="mt-4">
                <ErrorSummary message={quoteMutation.isError ? getApiErrorMessage(quoteMutation.error) : createMutation.isError ? getApiErrorMessage(createMutation.error) : undefined} />
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button className="w-full sm:w-auto" disabled={!addressesQuery.data?.length || createMutation.isPending} loading={quoteMutation.isPending} onClick={calculate} variant="secondary">Tính lại phí</Button>
                <Button className="w-full sm:w-auto" disabled={!quoteIsCurrent || quoteMutation.isPending} loading={createMutation.isPending} type="submit">Tạo vận đơn</Button>
              </div>
              {!quoteIsCurrent && quoteMutation.data ? (
                <p className="mt-4 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm font-medium text-warning" role="status">Thông tin đã thay đổi. Hãy tính lại phí trước khi tạo.</p>
              ) : null}
            </div>
            <div aria-live="polite" className="min-w-0 lg:sticky lg:top-6">
              {quoteMutation.data ? (
                <div className="space-y-4">
                  <PriceBreakdown pricing={quoteMutation.data} />
                  {currentValues.shippingFeePayer ? (
                    <ShippingFeeResponsibilityCard
                      payer={currentValues.shippingFeePayer}
                      title="Xác nhận thanh toán"
                    />
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  compact
                  description="Tính phí để mở khóa nút tạo vận đơn. Backend vẫn tính lại lần cuối khi lưu."
                  title="Bước xác nhận phí"
                />
              )}
            </div>
          </form>
        )}
      </div>
    </AccountLayout>
  );
}
