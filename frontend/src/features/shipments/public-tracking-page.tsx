import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from '../../components/logo-mark';
import { ShipmentStatusBadge } from '../../components/shipment-status-badge';
import { ShipmentTimeline } from '../../components/shipment-timeline';
import { Button } from '../../components/ui/button';
import { ErrorSummary } from '../../components/ui/error-summary';
import { FormField } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { getApiErrorMessage } from '../../services/api-error';
import { getPublicTracking } from './shipment-api';

export function PublicTrackingPage() {
  const [trackingCode, setTrackingCode] = useState('');
  const trackingMutation = useMutation({ mutationFn: getPublicTracking });

  return (
    <div className="min-h-dvh bg-background text-ink">
      <a className="skip-link" href="#tracking-content">Đến nội dung chính</a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-18 max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link className="focus-ring inline-flex min-h-11 items-center gap-3 rounded-control font-semibold text-ink" to="/"><LogoMark className="size-10 text-primary" />Logistics</Link>
          <Link className="focus-ring ui-transition inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-primary hover:bg-primary-soft hover:text-primary-strong" to="/login">Đăng nhập</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8 lg:py-16" id="tracking-content">
        <PageHeader
          description="Nhập mã bắt đầu bằng SHP để xem trạng thái công khai. Dữ liệu nội bộ và thông tin cá nhân không được hiển thị."
          eyebrow="Theo dõi công khai"
          title="Tra cứu hành trình vận đơn"
        />
        <form className="mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface sm:p-6" onSubmit={(event) => { event.preventDefault(); if (trackingCode.trim()) trackingMutation.mutate(trackingCode.trim()); }}>
          <FormField autoCapitalize="characters" id="tracking-code" label="Mã vận đơn" onChange={(event) => setTrackingCode(event.target.value.toUpperCase())} placeholder="SHP-20260817-A1B2C3D4" value={trackingCode} />
          <div className="mt-4">
            <ErrorSummary message={trackingMutation.isError ? getApiErrorMessage(trackingMutation.error) : undefined} />
          </div>
          <Button className="mt-5 w-full sm:w-auto" disabled={!trackingCode.trim()} loading={trackingMutation.isPending} type="submit">Tra cứu</Button>
        </form>
        {trackingMutation.data ? (
          <section className="mt-6 rounded-surface border border-border bg-surface p-5 shadow-surface sm:mt-8 sm:p-6" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><p className="text-sm font-medium text-muted-foreground">Mã vận đơn</p><h2 className="mt-1 break-all text-lg font-semibold text-primary sm:text-xl">{trackingMutation.data.trackingCode}</h2></div>
              <ShipmentStatusBadge status={trackingMutation.data.status} />
            </div>
            <p className="mt-4 font-medium text-ink">{trackingMutation.data.originCity} → {trackingMutation.data.destinationCity}</p>
            <div className="mt-7 border-t border-border pt-7"><ShipmentTimeline events={trackingMutation.data.timeline} /></div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
