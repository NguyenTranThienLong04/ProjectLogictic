import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { listAddresses } from '../addresses/address-api';
import { AccountLayout } from '../auth/components/account-layout';
import {
  quoteInput,
  shipmentFormDefaults,
  shipmentFormSchema,
  type ShipmentFormValues,
} from '../shipments/shipment-form';
import { ShipmentFormFields } from '../shipments/shipment-form-fields';
import { getQuote } from './pricing-api';
import { PriceBreakdown } from './price-breakdown';

export function QuotePage() {
  const addressesQuery = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });
  const { formState, handleSubmit, register, control, setValue } = useForm<ShipmentFormValues>({
    resolver: zodResolver(shipmentFormSchema),
    mode: 'onBlur',
    defaultValues: shipmentFormDefaults,
  });
  const selectedLocation = useWatch({ control });
  const quoteMutation = useMutation({ mutationFn: getQuote });
  const submit = handleSubmit((values) => {
    const pickup = addressesQuery.data?.find((address) => address.id === values.pickupAddressId);
    if (pickup) quoteMutation.mutate(quoteInput(values, pickup));
  });

  if (addressesQuery.isPending) return <LoadingState label="Đang chuẩn bị biểu phí" />;

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          description="Nhập thông tin kiện hàng để xem phí theo bảng giá đang hoạt động. Báo giá không tạo vận đơn."
          eyebrow="Ước tính minh bạch"
          title="Báo giá vận chuyển"
        />

        {addressesQuery.isError ? (
          <div className="mt-8">
            <ErrorState
              message={getApiErrorMessage(addressesQuery.error)}
              onRetry={() => addressesQuery.refetch()}
              title="Không thể chuẩn bị báo giá"
            />
          </div>
        ) : (
          <form className="mt-6 grid min-w-0 gap-6 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start" noValidate onSubmit={submit}>
            <div className="min-w-0">
              <ShipmentFormFields
                deliveryLocation={selectedLocation.deliveryLatitude !== undefined && selectedLocation.deliveryLongitude !== undefined ? { latitude: selectedLocation.deliveryLatitude!, longitude: selectedLocation.deliveryLongitude! } : undefined}
                onDeliveryLocation={(point) => { setValue('deliveryLatitude', point.latitude, { shouldDirty: true, shouldValidate: true }); setValue('deliveryLongitude', point.longitude, { shouldDirty: true, shouldValidate: true }); }}
                addresses={addressesQuery.data ?? []} errors={formState.errors} register={register} />
              <div className="mt-4">
                <ErrorSummary message={quoteMutation.isError ? getApiErrorMessage(quoteMutation.error) : undefined} />
              </div>
              <Button className="mt-6 w-full sm:w-auto" disabled={!addressesQuery.data?.length} loading={quoteMutation.isPending} type="submit">Tính phí vận chuyển</Button>
            </div>
            <div aria-live="polite" className="min-w-0 lg:sticky lg:top-6">
              {quoteMutation.data ? (
                <PriceBreakdown pricing={quoteMutation.data} />
              ) : (
                <EmptyState
                  compact
                  description="Chi tiết phí sẽ xuất hiện tại đây sau khi biểu mẫu hợp lệ được gửi."
                  title="Kết quả báo giá"
                />
              )}
            </div>
          </form>
        )}
      </div>
    </AccountLayout>
  );
}
