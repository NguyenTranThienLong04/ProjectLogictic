import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ShipmentStatusBadge } from '../../components/shipment-status-badge';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { dateTimeFormatter, vndFormatter } from '../../utils/format';
import { AccountLayout } from '../auth/components/account-layout';
import type { AddressSnapshot } from '../shipments/shipment-types';
import { ShippingFeeResponsibilityCard } from '../shipments/shipping-fee-responsibility-card';
import { getOperationalShipment } from './operations-api';
import type { WarehouseReference } from './operations-types';

interface OperationalShipmentDetailPageProps {
  role: 'admin' | 'dispatcher';
}

export function OperationalShipmentDetailPage({ role }: OperationalShipmentDetailPageProps) {
  const { id = '' } = useParams();
  const shipment = useQuery({
    queryKey: ['operational-shipment', id],
    queryFn: () => getOperationalShipment(id),
    enabled: Boolean(id),
  });
  const basePath = role === 'admin' ? '/admin/shipments' : '/dispatcher/shipments';

  if (shipment.isPending) return <LoadingState label="Đang tải chi tiết vận đơn" />;

  return (
    <AccountLayout>
      <main className="mx-auto max-w-6xl">
        {shipment.isError ? (
          <ErrorState
            message={getApiErrorMessage(shipment.error)}
            onRetry={() => shipment.refetch()}
            title="Không thể tải chi tiết vận đơn"
          />
        ) : shipment.data ? (
          <>
            <Link
              className="focus-ring ui-transition mb-4 inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-semibold text-primary hover:text-primary-strong"
              to={basePath}
            >
              <svg
                aria-hidden="true"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              Quay lại danh sách
            </Link>
            <PageHeader
              actions={<ShipmentStatusBadge status={shipment.data.status} />}
              description={`Tạo lúc ${dateTimeFormatter.format(new Date(shipment.data.createdAt))}`}
              eyebrow={role === 'admin' ? 'Admin · Chi tiết vận đơn' : 'Dispatcher · Chi tiết vận đơn'}
              title={shipment.data.trackingCode}
            />

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
              <div className="space-y-6">
                <section className="grid gap-4 md:grid-cols-2">
                  <ContactCard
                    address={shipment.data.pickup}
                    contactName={shipment.data.sender.fullName}
                    phone={shipment.data.sender.phone}
                    title="Người gửi và điểm lấy"
                  />
                  <ContactCard
                    address={shipment.data.delivery}
                    contactName={shipment.data.receiver.fullName}
                    phone={shipment.data.receiver.phone}
                    title="Người nhận và điểm giao"
                  />
                </section>

                <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6">
                  <h2 className="text-lg font-semibold text-ink">Kiện hàng</h2>
                  <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Detail label="Mô tả" value={shipment.data.package.description} />
                    <Detail label="Loại kiện" value={shipment.data.package.packageType} />
                    <Detail
                      label="Khối lượng"
                      value={`${shipment.data.package.weightGrams.toLocaleString('vi-VN')} gram`}
                    />
                    <Detail
                      label="Kích thước"
                      value={`${shipment.data.package.lengthCm} × ${shipment.data.package.widthCm} × ${shipment.data.package.heightCm} cm`}
                    />
                  </dl>
                </section>

                <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6">
                  <h2 className="text-lg font-semibold text-ink">Vận hành</h2>
                  <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Detail
                      label="Kho xuất phát"
                      value={warehouseLabel(shipment.data.originWarehouse)}
                    />
                    <Detail
                      label="Kho đích"
                      value={warehouseLabel(shipment.data.destinationWarehouse)}
                    />
                    <Detail
                      label="Tài xế lấy hàng"
                      value={shipment.data.pickupAssignment?.driverName ?? 'Chưa phân công'}
                    />
                    <Detail
                      label="Tài xế giao hàng"
                      value={shipment.data.deliveryAssignment?.driverName ?? 'Chưa phân công'}
                    />
                  </dl>
                </section>
              </div>

              <aside className="space-y-4 lg:sticky lg:top-6">
                <ShippingFeeResponsibilityCard transaction={shipment.data.shippingFee} />
                <section className="rounded-surface border border-orange-200 bg-orange-50 p-5">
                  <h2 className="font-semibold text-ink">COD</h2>
                  <dl className="mt-4">
                    <Detail
                      label="Tiền thu hộ hàng hóa"
                      value={vndFormatter.format(shipment.data.codAmount)}
                    />
                  </dl>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Không bao gồm phí vận chuyển.
                  </p>
                </section>
              </aside>
            </div>
          </>
        ) : (
          <EmptyState
            description="Dữ liệu vận đơn chưa sẵn sàng. Hãy quay lại danh sách và thử lại."
            title="Không tìm thấy vận đơn"
          />
        )}
      </main>
    </AccountLayout>
  );
}

function ContactCard({
  address,
  contactName,
  phone,
  title,
}: {
  address: AddressSnapshot;
  contactName: string;
  phone: string | null;
  title: string;
}) {
  return (
    <section className="rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6">
      <h2 className="font-semibold text-ink">{title}</h2>
      <p className="mt-3 font-semibold text-ink">
        {contactName} · {phone ?? 'Chưa có số điện thoại'}
      </p>
      <p className="mt-2 leading-7 text-muted-foreground">
        {address.streetAddress}, {address.ward}, {address.district}, {address.city}
      </p>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold text-ink">{value}</dd>
    </div>
  );
}

function warehouseLabel(warehouse: WarehouseReference | null): string {
  return warehouse ? `${warehouse.code} · ${warehouse.name}` : 'Chưa xác định';
}
