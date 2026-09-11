import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ShipmentStatusBadge } from '../../components/shipment-status-badge';
import { ShipmentTimeline } from '../../components/shipment-timeline';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorSummary } from '../../components/ui/error-summary';
import { ErrorState } from '../../components/ui/error-state';
import { FormField } from '../../components/ui/form-field';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import { PriceBreakdown } from '../pricing/price-breakdown';
import { ShipmentLocationMap } from '../locations/shipment-location-map';
import { cancelShipment, getShipment } from './shipment-api';
import { ShippingFeeResponsibilityCard } from './shipping-fee-responsibility-card';
import { ShippingFeePaymentPanel } from '../shipping-fees/shipping-fee-payment-panel';

export function ShipmentDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('');
  const shipmentQuery = useQuery({
    queryKey: ['shipment', id],
    queryFn: () => getShipment(id),
    enabled: Boolean(id),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelShipment(id, reason),
    onSuccess: (shipment) => {
      queryClient.setQueryData(['shipment', id], shipment);
      queryClient.invalidateQueries({ queryKey: ['shipments'] });
      setShowCancel(false);
    },
  });

  if (shipmentQuery.isPending) return <LoadingState label="Đang tải chi tiết vận đơn" />;

  return (
    <AccountLayout>
      <div className="mx-auto max-w-6xl">
        {shipmentQuery.isError ? (
          <ErrorState
            message={getApiErrorMessage(shipmentQuery.error)}
            onRetry={() => shipmentQuery.refetch()}
            title="Không thể tải chi tiết vận đơn"
          />
        ) : shipmentQuery.data ? (
          <>
            <Link
              className="focus-ring ui-transition mb-4 inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-semibold text-primary hover:text-primary-strong"
              to="/shipments"
            >
              <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Quay lại danh sách
            </Link>
            <PageHeader
              actions={(
                <div aria-live="polite">
                  <ShipmentStatusBadge status={shipmentQuery.data.status} />
                </div>
              )}
              description={`Tạo lúc ${dateTimeFormatter.format(new Date(shipmentQuery.data.createdAt))}`}
              eyebrow="Chi tiết vận đơn"
              title={shipmentQuery.data.trackingCode}
            />

            <div className="mt-6 grid gap-5 sm:mt-8 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
              <div className="space-y-6">
                <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6">
                  <h2 className="text-lg font-semibold text-ink sm:text-xl">Hành trình</h2>
                  <div className="mt-6"><ShipmentTimeline events={shipmentQuery.data.timeline} /></div>
                </section>
                <section className="grid gap-4 md:grid-cols-2">
                  <AddressCard title="Địa chỉ lấy hàng" address={shipmentQuery.data.pickup} />
                  <AddressCard title="Địa chỉ giao hàng" address={shipmentQuery.data.delivery} />
                </section>
                <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6">
                  <h2 className="text-lg font-semibold text-ink sm:text-xl">Thông tin kiện hàng</h2>
                  <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Detail label="Mô tả" value={shipmentQuery.data.package.description} />
                    <Detail label="Loại kiện" value={shipmentQuery.data.package.packageType} />
                    <Detail label="Khối lượng" value={`${shipmentQuery.data.package.weightGrams.toLocaleString('vi-VN')} gram`} />
                    <Detail label="Kích thước" value={`${shipmentQuery.data.package.lengthCm} × ${shipmentQuery.data.package.widthCm} × ${shipmentQuery.data.package.heightCm} cm`} />
                    <Detail label="Tiền COD" value={vndFormatter.format(shipmentQuery.data.codAmount)} />
                  </dl>
                </section>
              </div>
              <aside className="space-y-6 lg:sticky lg:top-6">
                <PriceBreakdown pricing={shipmentQuery.data.pricing} />
                <ShippingFeeResponsibilityCard transaction={shipmentQuery.data.shippingFee} />
                <ShippingFeePaymentPanel
                  expectedAmount={shipmentQuery.data.shippingFee.expectedAmount}
                  shipmentId={shipmentQuery.data.id}
                />
                <section className="rounded-surface border border-orange-200 bg-orange-50 p-5">
                  <h2 className="font-semibold text-ink">COD</h2>
                  <dl className="mt-4">
                    <Detail
                      label="Tiền thu hộ hàng hóa"
                      value={vndFormatter.format(shipmentQuery.data.codAmount)}
                    />
                  </dl>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    COD là khoản thu hộ hàng hóa, tách biệt với phí vận chuyển.
                  </p>
                </section>
                {shipmentQuery.data.status === 'OUT_FOR_DELIVERY' ? (
                  <section className="overflow-hidden rounded-surface border border-border bg-surface p-4 shadow-surface">
                    <h2 className="font-semibold text-ink">Tài xế đang giao hàng</h2>
                    <div className="mt-4"><ShipmentLocationMap shipmentId={shipmentQuery.data.id} /></div>
                  </section>
                ) : null}
                {shipmentQuery.data.canCancel ? (
                  <section className="rounded-surface border border-danger/30 bg-danger-soft p-5 sm:p-6">
                    <h2 className="font-semibold text-ink">Hủy vận đơn</h2>
                    {!showCancel ? (
                      <Button className="mt-4 w-full" onClick={() => setShowCancel(true)} variant="danger">Yêu cầu hủy</Button>
                    ) : (
                      <div className="mt-4">
                        <FormField id="cancel-reason" label="Lý do hủy" maxLength={500} minLength={3} onChange={(event) => setReason(event.target.value)} value={reason} />
                        <div className="mt-4">
                          <ErrorSummary message={cancelMutation.isError ? getApiErrorMessage(cancelMutation.error) : undefined} />
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <Button className="w-full" disabled={reason.trim().length < 3} loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate()} variant="danger">Xác nhận hủy</Button>
                          <Button className="w-full" disabled={cancelMutation.isPending} onClick={() => setShowCancel(false)} variant="secondary">Giữ vận đơn</Button>
                        </div>
                      </div>
                    )}
                  </section>
                ) : null}
              </aside>
            </div>
          </>
        ) : (
          <EmptyState
            description="Dữ liệu vận đơn chưa sẵn sàng. Hãy quay lại danh sách và thử lại."
            title="Không tìm thấy vận đơn"
          />
        )}
      </div>
    </AccountLayout>
  );
}

function AddressCard({ address, title }: { address: { contactName: string; phone: string; streetAddress: string; ward: string; district: string; city: string }; title: string }) {
  return (
    <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6">
      <h2 className="font-semibold text-ink">{title}</h2>
      <p className="mt-3 font-semibold text-ink">{address.contactName} · {address.phone}</p>
      <p className="mt-2 leading-7 text-muted-foreground">{address.streetAddress}, {address.ward}, {address.district}, {address.city}</p>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-sm font-medium text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold text-ink">{value}</dd></div>;
}
