import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/ui/button';
import { DataTable } from '../../../components/ui/data-table';
import { EmptyState } from '../../../components/ui/empty-state';
import { ErrorState } from '../../../components/ui/error-state';
import { ErrorSummary } from '../../../components/ui/error-summary';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { LoadingState } from '../../../components/ui/loading-state';
import { Modal } from '../../../components/ui/modal';
import { PageHeader } from '../../../components/ui/page-header';
import { SelectField } from '../../../components/ui/select-field';
import { WarehouseTransferStatusBadge } from '../../../components/ui/status-badge';
import { ShipmentStatusBadge } from '../../../components/shipment-status-badge';
import { getApiErrorMessage } from '../../../services/api-error';
import { formatCurrency, formatDateTime, formatWeight } from '../../../utils/format';
import { useAuth } from '../../auth/auth-context';
import { AccountLayout } from '../../auth/components/account-layout';
import {
  checkInShipment,
  createTransfer,
  dispatchTransfer,
  getMyStaffProfile,
  listInboundQueue,
  listTransfers,
  listWarehouses,
  listWarehouseShipments,
  lookupCheckInShipment,
  markReadyForDelivery,
  receiveTransfer,
  routeDestination,
} from '../warehouses-api';
import type {
  WarehouseCatalogueItem,
  WarehouseShipment,
  WarehouseTransfer,
} from '../warehouse-types';

type WorkspaceTab = 'inbound' | 'inventory' | 'outbound_transfers' | 'inbound_transfers';

export function WarehouseWorkspacePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('inbound');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [scanCode, setScanCode] = useState('');
  const [success, setSuccess] = useState('');

  // Modals state
  const [checkInModalShipment, setCheckInModalShipment] = useState<WarehouseShipment | null>(null);
  const [sortingModalShipment, setSortingModalShipment] = useState<WarehouseShipment | null>(null);
  const [transferModalShipment, setTransferModalShipment] = useState<WarehouseShipment | null>(
    null,
  );
  const [dispatchModalTransfer, setDispatchModalTransfer] = useState<WarehouseTransfer | null>(
    null,
  );
  const [receiveModalTransfer, setReceiveModalTransfer] = useState<WarehouseTransfer | null>(null);

  // Form states for modals
  const [checkInWeight, setCheckInWeight] = useState<string>('');
  const [checkInLength, setCheckInLength] = useState<string>('');
  const [checkInWidth, setCheckInWidth] = useState<string>('');
  const [checkInHeight, setCheckInHeight] = useState<string>('');
  const [checkInNote, setCheckInNote] = useState('');
  const [packageVerified, setPackageVerified] = useState(false);

  const [sortingDestWh, setSortingDestWh] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [transferClientRequestId, setTransferClientRequestId] = useState('');

  const [receiveNote, setReceiveNote] = useState('');
  const [receiveWeight, setReceiveWeight] = useState('');

  // 1. Load warehouse context
  const staffProfile = useQuery({
    queryKey: ['warehouse-staff-me'],
    queryFn: getMyStaffProfile,
    enabled: user?.role === 'WAREHOUSE_STAFF',
  });

  const allWarehouses = useQuery({
    queryKey: ['all-warehouses-lookup'],
    queryFn: () => listWarehouses<WarehouseCatalogueItem>({ isActive: true }),
  });

  const activeWarehouseId =
    user?.role === 'WAREHOUSE_STAFF'
      ? staffProfile.data?.warehouseId || ''
      : selectedWarehouseId || allWarehouses.data?.items?.[0]?.id || '';

  const activeWarehouse = allWarehouses.data?.items?.find((w) => w.id === activeWarehouseId);

  // 2. Load warehouse data
  const inboundQueue = useQuery({
    queryKey: ['inbound-queue', activeWarehouseId],
    queryFn: () => listInboundQueue(activeWarehouseId),
    enabled: Boolean(activeWarehouseId),
  });

  const inventoryShipments = useQuery({
    queryKey: ['warehouse-inventory', activeWarehouseId],
    queryFn: () => listWarehouseShipments(activeWarehouseId),
    enabled: Boolean(activeWarehouseId),
  });

  const outboundTransfers = useQuery({
    queryKey: ['outbound-transfers', activeWarehouseId],
    queryFn: () => listTransfers(activeWarehouseId, 'outbound'),
    enabled: Boolean(activeWarehouseId),
  });

  const inboundTransfers = useQuery({
    queryKey: ['inbound-transfers', activeWarehouseId],
    queryFn: () => listTransfers(activeWarehouseId, 'inbound'),
    enabled: Boolean(activeWarehouseId),
  });

  // Mutations
  const lookupMutation = useMutation({
    mutationFn: (trackingCode: string) => lookupCheckInShipment(activeWarehouseId, trackingCode),
    onSuccess: (shipment) => openCheckInModal(shipment),
  });

  const checkInMutation = useMutation({
    mutationFn: (input: {
      trackingCode?: string;
      shipmentId?: string;
      packageVerified: true;
      actualWeightGrams: number;
      lengthCm: number;
      widthCm: number;
      heightCm: number;
      note?: string;
    }) => checkInShipment(activeWarehouseId, input),
    onSuccess: async (res) => {
      setCheckInModalShipment(null);
      setScanCode('');
      setPackageVerified(false);
      setActiveTab('inventory');
      setSuccess(
        res.idempotent
          ? `Vận đơn ${res.shipment.trackingCode} đã ở tại kho này từ trước.`
          : `Đã nhập kho xuất phát vận đơn ${res.shipment.trackingCode} thành công.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inbound-queue', activeWarehouseId] }),
        queryClient.invalidateQueries({ queryKey: ['warehouse-inventory', activeWarehouseId] }),
      ]);
    },
  });

  const routeDestinationMutation = useMutation({
    mutationFn: (input: { shipmentId: string; destinationWarehouseId: string }) =>
      routeDestination(activeWarehouseId, input.shipmentId, input.destinationWarehouseId),
    onSuccess: async (shipment) => {
      setSortingModalShipment(null);
      setSuccess(
        shipment.status === 'AWAITING_DELIVERY_ASSIGNMENT'
          ? `Vận đơn ${shipment.trackingCode} cùng kho đích và đã sẵn sàng điều phối giao.`
          : `Đã xác nhận kho đích cho vận đơn ${shipment.trackingCode}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['warehouse-inventory', activeWarehouseId] });
    },
  });

  const transferMutation = useMutation({
    mutationFn: (input: {
      shipmentId: string;
      toWarehouseId: string;
      note?: string;
      clientRequestId: string;
    }) => createTransfer(activeWarehouseId, input),
    onSuccess: async (transfer) => {
      setTransferModalShipment(null);
      setTransferNote('');
      setTransferClientRequestId('');
      setActiveTab('outbound_transfers');
      setSuccess(`Đã tạo chuyến ${transfer.transferCode}. Chuyến đang chờ xác nhận xuất kho.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['warehouse-inventory', activeWarehouseId] }),
        queryClient.invalidateQueries({ queryKey: ['outbound-transfers', activeWarehouseId] }),
      ]);
    },
  });

  const dispatchTransferMutation = useMutation({
    mutationFn: (transferId: string) => dispatchTransfer(activeWarehouseId, transferId),
    onSuccess: async (transfer) => {
      setDispatchModalTransfer(null);
      setSuccess(`Đã xuất kho chuyến ${transfer.transferCode}; kiện hàng đang trung chuyển.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['warehouse-inventory', activeWarehouseId] }),
        queryClient.invalidateQueries({ queryKey: ['outbound-transfers', activeWarehouseId] }),
      ]);
    },
  });

  const receiveTransferMutation = useMutation({
    mutationFn: (input: { transferId: string; note?: string; actualWeightGrams?: number }) =>
      receiveTransfer(activeWarehouseId, input.transferId, {
        note: input.note,
        actualWeightGrams: input.actualWeightGrams,
      }),
    onSuccess: async (transfer) => {
      setReceiveModalTransfer(null);
      setReceiveNote('');
      setReceiveWeight('');
      setActiveTab('inventory');
      setSuccess(`Đã tiếp nhận chuyến trung chuyển ${transfer.transferCode} vào kho đích.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inbound-transfers', activeWarehouseId] }),
        queryClient.invalidateQueries({ queryKey: ['warehouse-inventory', activeWarehouseId] }),
      ]);
    },
  });

  const readyForDeliveryMutation = useMutation({
    mutationFn: (shipmentId: string) => markReadyForDelivery(activeWarehouseId, shipmentId),
    onSuccess: async (shipment) => {
      setSuccess(`Vận đơn ${shipment.trackingCode} đã sẵn sàng điều phối giao hàng.`);
      await queryClient.invalidateQueries({ queryKey: ['warehouse-inventory', activeWarehouseId] });
    },
  });

  // Handle Quick Scan Barcode
  const handleQuickScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanCode.trim().toUpperCase();
    if (!code) return;

    // Check if in inbound queue
    const foundInbound = inboundQueue.data?.pickedUpShipments?.find(
      (shipment) => shipment.trackingCode.toUpperCase() === code,
    );
    if (foundInbound) {
      openCheckInModal(foundInbound);
      return;
    }

    // Look up through the backend so unknown or wrong-origin codes never bypass verification.
    lookupMutation.mutate(code);
  };

  const openCheckInModal = (shipment: WarehouseShipment) => {
    setCheckInModalShipment(shipment);
    setCheckInWeight(String(shipment.packageSnapshot?.weightGrams || ''));
    setCheckInLength(String(shipment.packageSnapshot?.lengthCm || ''));
    setCheckInWidth(String(shipment.packageSnapshot?.widthCm || ''));
    setCheckInHeight(String(shipment.packageSnapshot?.heightCm || ''));
    setCheckInNote('');
    setPackageVerified(false);
  };

  const openSortingModal = (shipment: WarehouseShipment) => {
    setSortingModalShipment(shipment);
    const otherWarehouse = allWarehouses.data?.items?.find(
      (warehouse) => warehouse.id !== activeWarehouseId,
    );
    setSortingDestWh(shipment.destinationWarehouseId || otherWarehouse?.id || activeWarehouseId);
  };

  const openTransferModal = (shipment: WarehouseShipment) => {
    setTransferModalShipment(shipment);
    setTransferNote('');
    setTransferClientRequestId(crypto.randomUUID());
  };

  const openReceiveModal = (transfer: WarehouseTransfer) => {
    setReceiveModalTransfer(transfer);
    setReceiveNote('');
    setReceiveWeight('');
  };

  const packageVerificationComplete =
    packageVerified &&
    [checkInWeight, checkInLength, checkInWidth, checkInHeight].every(
      (value) => Number.isFinite(Number(value)) && Number(value) > 0,
    );

  if (user?.role === 'WAREHOUSE_STAFF' && staffProfile.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải thông tin nhân viên kho..." />
      </AccountLayout>
    );
  }

  if (user?.role === 'WAREHOUSE_STAFF' && staffProfile.isError) {
    return (
      <AccountLayout>
        <ErrorState
          message={getApiErrorMessage(staffProfile.error)}
          onRetry={() => void staffProfile.refetch()}
          title="Không thể tải hồ sơ nhân viên kho"
        />
      </AccountLayout>
    );
  }

  if (user?.role === 'WAREHOUSE_STAFF' && !staffProfile.data) {
    return (
      <AccountLayout>
        <EmptyState
          description="Tài khoản của bạn chưa được liên kết với kho hàng nào. Vui lòng liên hệ Admin để được phân công."
          title="Chưa được phân công kho"
        />
      </AccountLayout>
    );
  }

  if (allWarehouses.isPending) {
    return (
      <AccountLayout>
        <LoadingState label="Đang tải danh mục kho hàng..." />
      </AccountLayout>
    );
  }

  if (allWarehouses.isError) {
    return (
      <AccountLayout>
        <ErrorState
          message={getApiErrorMessage(allWarehouses.error)}
          onRetry={() => void allWarehouses.refetch()}
          title="Không thể tải danh mục kho hàng"
        />
      </AccountLayout>
    );
  }

  if (!activeWarehouseId) {
    return (
      <AccountLayout>
        <EmptyState
          description="Chưa có kho đang hoạt động để mở không gian vận hành."
          title="Không có kho làm việc"
        />
      </AccountLayout>
    );
  }

  const getTabClassName = (tab: WorkspaceTab) =>
    'focus-ring ui-transition min-h-12 rounded-control border px-3 py-2 text-sm font-semibold transition-colors ' +
    (activeTab === tab
      ? 'border-primary bg-primary text-on-primary shadow-surface'
      : 'border-border bg-surface text-muted-foreground hover:border-border-strong hover:bg-surface-muted hover:text-ink');

  return (
    <AccountLayout>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          actions={
            user?.role === 'ADMIN' || user?.role === 'DISPATCHER' ? (
              <div className="w-full sm:min-w-80">
                <SelectField
                  id="wh-select"
                  label="Kho đang vận hành"
                  value={activeWarehouseId}
                  onChange={(event) => setSelectedWarehouseId(event.target.value)}
                >
                  {allWarehouses.data?.items?.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.code} - {warehouse.name} ({warehouse.address})
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : (
              <div className="rounded-surface border border-border bg-surface-subtle px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Nhân viên trực kho
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {staffProfile.data?.user.fullName}
                </p>
                <p className="font-mono text-xs font-semibold text-primary">
                  {staffProfile.data?.staffCode}
                </p>
              </div>
            )
          }
          description={
            activeWarehouse
              ? activeWarehouse.address
              : 'Quản lý vận hành nhập, xuất kho và trung chuyển mạng lưới.'
          }
          eyebrow="Warehouse portal"
          meta={
            <>
              <span className="rounded-pill border border-border bg-surface-subtle px-2.5 py-1 font-mono text-xs font-semibold text-primary">
                {activeWarehouse?.code || 'WAREHOUSE'}
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {inboundQueue.data?.pickedUpShipments?.length ?? 0} chờ nhập
              </span>
              <span aria-hidden="true" className="text-border-strong">
                •
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {inventoryShipments.data?.pagination?.total ?? 0} kiện tại kho
              </span>
            </>
          }
          title={activeWarehouse ? activeWarehouse.name : 'Không gian làm việc kho'}
        />

        <section
          aria-labelledby="quick-scan-heading"
          className="mt-6 rounded-surface border border-primary/30 bg-primary-soft p-4 sm:p-5"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(13rem,0.34fr)_minmax(0,1fr)] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-primary">
                Thao tác nhanh
              </p>
              <h2 className="mt-1 text-lg font-semibold text-ink" id="quick-scan-heading">
                Quét hoặc tra cứu kiện
              </h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Máy quét nhập mã vào ô này. Hệ thống chỉ mở bước kiểm hàng, chưa tự check-in.
              </p>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={handleQuickScan}
            >
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink" htmlFor="quick-scan">
                  Mã vận đơn hoặc mã vạch
                </label>
                <Input
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="font-mono font-semibold uppercase"
                  id="quick-scan"
                  placeholder="Ví dụ: SHP-20260817-A1B2C3"
                  value={scanCode}
                  onChange={(event) => setScanCode(event.target.value)}
                />
              </div>
              <Button
                className="w-full sm:mb-0 sm:w-auto sm:self-end"
                disabled={!scanCode.trim()}
                loading={lookupMutation.isPending}
                type="submit"
              >
                Tra cứu kiện
              </Button>
            </form>
          </div>
          <div className="mt-4">
            <ErrorSummary
              message={
                lookupMutation.isError ? getApiErrorMessage(lookupMutation.error) : undefined
              }
            />
          </div>
        </section>

        {success ? (
          <p
            aria-live="polite"
            className="mt-4 rounded-control border border-success/30 bg-success-soft p-4 text-sm font-semibold text-success"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <div
          aria-label="Khu vực vận hành kho"
          className="mt-6 grid grid-cols-2 gap-2 border-b border-border pb-4 lg:flex lg:flex-wrap"
          role="tablist"
        >
          <button
            aria-controls="warehouse-panel-inbound"
            aria-selected={activeTab === 'inbound'}
            className={getTabClassName('inbound')}
            id="warehouse-tab-inbound"
            onClick={() => setActiveTab('inbound')}
            role="tab"
            type="button"
          >
            Chờ nhập ({inboundQueue.data?.pickedUpShipments?.length ?? 0})
          </button>
          <button
            aria-controls="warehouse-panel-inventory"
            aria-selected={activeTab === 'inventory'}
            className={getTabClassName('inventory')}
            id="warehouse-tab-inventory"
            onClick={() => setActiveTab('inventory')}
            role="tab"
            type="button"
          >
            Tồn kho ({inventoryShipments.data?.pagination?.total ?? 0})
          </button>
          <button
            aria-controls="warehouse-panel-outbound-transfers"
            aria-selected={activeTab === 'outbound_transfers'}
            className={getTabClassName('outbound_transfers')}
            id="warehouse-tab-outbound-transfers"
            onClick={() => setActiveTab('outbound_transfers')}
            role="tab"
            type="button"
          >
            Chuyển đi ({outboundTransfers.data?.length ?? 0})
          </button>
          <button
            aria-controls="warehouse-panel-inbound-transfers"
            aria-selected={activeTab === 'inbound_transfers'}
            className={getTabClassName('inbound_transfers')}
            id="warehouse-tab-inbound-transfers"
            onClick={() => setActiveTab('inbound_transfers')}
            role="tab"
            type="button"
          >
            Chuyển đến (
            {inboundTransfers.data?.filter((transfer) => transfer.status === 'IN_TRANSIT').length ??
              0}
            )
          </button>
        </div>

        {/* TAB 1: INBOUND PICKUPS */}
        {activeTab === 'inbound' ? (
          <section
            aria-labelledby="warehouse-tab-inbound"
            className="mt-6 space-y-4"
            id="warehouse-panel-inbound"
            role="tabpanel"
          >
            <div>
              <h2 className="text-lg font-semibold text-ink">Hàng đã lấy chờ nhập kho</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Đối chiếu kiện hàng, cân đo thực tế và xác nhận check-in tại kho xuất phát.
              </p>
            </div>
            <DataTable
              caption="Danh sách vận đơn chờ nhập kho"
              columns={[
                {
                  id: 'trackingCode',
                  header: 'Mã vận đơn',
                  render: (shipment) => (
                    <span className="font-mono font-semibold text-primary">
                      {shipment.trackingCode}
                    </span>
                  ),
                },
                {
                  id: 'package',
                  header: 'Kiện hàng',
                  render: (shipment) => (
                    <div>
                      <p className="font-medium text-ink">
                        {shipment.packageSnapshot?.description || 'Hàng hóa'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatWeight(shipment.packageSnapshot?.weightGrams || 0)}
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'contacts',
                  header: 'Người gửi → người nhận',
                  render: (shipment) => (
                    <div>
                      <p className="font-medium text-ink">
                        {shipment.senderSnapshot?.fullName || '—'} →{' '}
                        {shipment.receiverSnapshot?.fullName || '—'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {shipment.deliverySnapshot?.city || 'Chưa có địa bàn'}
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'status',
                  header: 'Trạng thái',
                  render: (shipment) => <ShipmentStatusBadge status={shipment.status} />,
                },
                {
                  id: 'action',
                  header: 'Thao tác',
                  align: 'right',
                  render: (shipment) => (
                    <Button
                      className="w-full whitespace-nowrap md:w-auto"
                      onClick={() => openCheckInModal(shipment)}
                    >
                      Kiểm hàng & nhập kho
                    </Button>
                  ),
                },
              ]}
              emptyDescription="Hiện không có kiện hàng PICKED_UP nào cần check-in tại kho."
              emptyTitle="Không có hàng chờ nhập"
              error={inboundQueue.isError ? getApiErrorMessage(inboundQueue.error) : undefined}
              getRowKey={(shipment) => shipment.id}
              loading={inboundQueue.isPending}
              loadingLabel="Đang tải hàng chờ nhập kho"
              onRetry={() => void inboundQueue.refetch()}
              rows={inboundQueue.data?.pickedUpShipments ?? []}
            />
          </section>
        ) : null}

        {/* TAB 2: IN-WAREHOUSE INVENTORY */}
        {activeTab === 'inventory' ? (
          <section
            aria-labelledby="warehouse-tab-inventory"
            className="mt-6 space-y-4"
            id="warehouse-panel-inventory"
            role="tabpanel"
          >
            <div>
              <h2 className="text-lg font-semibold text-ink">
                Hàng tồn tại kho {activeWarehouse?.name ? `— ${activeWarehouse.name}` : ''}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Theo dõi kiện đang lưu kho, điều phối trung chuyển hoặc bàn giao sang khâu giao
                hàng.
              </p>
            </div>
            <ErrorSummary
              message={
                routeDestinationMutation.isError
                  ? getApiErrorMessage(routeDestinationMutation.error)
                  : transferMutation.isError
                    ? getApiErrorMessage(transferMutation.error)
                    : readyForDeliveryMutation.isError
                      ? getApiErrorMessage(readyForDeliveryMutation.error)
                      : undefined
              }
            />
            <DataTable
              caption="Danh sách hàng đang lưu tại kho"
              columns={[
                {
                  id: 'trackingCode',
                  header: 'Mã vận đơn',
                  render: (shipment) => (
                    <span className="font-mono font-semibold text-primary">
                      {shipment.trackingCode}
                    </span>
                  ),
                },
                {
                  id: 'package',
                  header: 'Kiện / khối lượng',
                  render: (shipment) => (
                    <div>
                      <p className="font-medium text-ink">
                        {shipment.packageSnapshot?.description || 'Hàng hóa'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatWeight(
                          shipment.packageSnapshot?.verifiedWeightGrams ||
                            shipment.packageSnapshot?.weightGrams ||
                            0,
                        )}
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'warehouseRoute',
                  header: 'Kho đi → kho đến',
                  render: (shipment) => (
                    <div>
                      <p className="font-medium text-ink">
                        {shipment.originWarehouse?.code || activeWarehouse?.code || '—'} →{' '}
                        {shipment.destinationWarehouse?.code || 'Chưa phân loại'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {shipment.destinationWarehouse?.name || shipment.deliverySnapshot?.city}
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'cod',
                  header: 'COD',
                  align: 'right',
                  render: (shipment) => (
                    <span className="whitespace-nowrap font-medium">
                      {formatCurrency(shipment.codAmount)}
                    </span>
                  ),
                },
                {
                  id: 'status',
                  header: 'Trạng thái',
                  render: (shipment) => <ShipmentStatusBadge status={shipment.status} />,
                },
                {
                  id: 'action',
                  header: 'Thao tác',
                  align: 'right',
                  render: (shipment) => {
                    const activeShipmentTransfer = outboundTransfers.data?.find(
                      (transfer) =>
                        transfer.shipmentId === shipment.id &&
                        (transfer.status === 'PENDING' || transfer.status === 'IN_TRANSIT'),
                    );
                    return (
                      <div className="flex w-full flex-col gap-2 xl:flex-row xl:justify-end">
                        {shipment.status === 'AT_ORIGIN_WAREHOUSE' && !activeShipmentTransfer ? (
                          <Button
                            className="w-full whitespace-nowrap xl:w-auto"
                            disabled={routeDestinationMutation.isPending}
                            onClick={() => openSortingModal(shipment)}
                            variant="secondary"
                          >
                            {shipment.destinationWarehouseId ? 'Đổi kho đích' : 'Phân loại'}
                          </Button>
                        ) : null}
                        {shipment.status === 'AT_ORIGIN_WAREHOUSE' &&
                        shipment.destinationWarehouseId &&
                        shipment.destinationWarehouseId !== activeWarehouseId &&
                        !activeShipmentTransfer ? (
                          <Button
                            className="w-full whitespace-nowrap xl:w-auto"
                            disabled={transferMutation.isPending}
                            onClick={() => openTransferModal(shipment)}
                          >
                            Tạo transfer
                          </Button>
                        ) : null}
                        {activeShipmentTransfer?.status === 'PENDING' ? (
                          <span className="self-center text-sm font-medium text-muted-foreground">
                            Đã tạo {activeShipmentTransfer.transferCode}
                          </span>
                        ) : null}
                        {shipment.status === 'AT_DESTINATION_WAREHOUSE' ? (
                          <Button
                            className="w-full whitespace-nowrap xl:w-auto"
                            disabled={readyForDeliveryMutation.isPending}
                            loading={
                              readyForDeliveryMutation.isPending &&
                              readyForDeliveryMutation.variables === shipment.id
                            }
                            onClick={() => readyForDeliveryMutation.mutate(shipment.id)}
                          >
                            Sẵn sàng giao
                          </Button>
                        ) : null}
                      </div>
                    );
                  },
                },
              ]}
              emptyDescription="Kho hiện chưa có kiện hàng nào đang lưu."
              emptyTitle="Kho đang trống"
              error={
                inventoryShipments.isError
                  ? getApiErrorMessage(inventoryShipments.error)
                  : undefined
              }
              getRowKey={(shipment) => shipment.id}
              loading={inventoryShipments.isPending}
              loadingLabel="Đang tải danh sách hàng tại kho"
              onRetry={() => void inventoryShipments.refetch()}
              rows={inventoryShipments.data?.items ?? []}
            />
          </section>
        ) : null}

        {/* TAB 3: OUTBOUND TRANSFERS */}
        {activeTab === 'outbound_transfers' ? (
          <section
            aria-labelledby="warehouse-tab-outbound-transfers"
            className="mt-6 space-y-4"
            id="warehouse-panel-outbound-transfers"
            role="tabpanel"
          >
            <div>
              <h2 className="text-lg font-semibold text-ink">Các chuyến trung chuyển gửi đi</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Chuyến mới tạo ở trạng thái chờ xuất; chỉ Dispatch mới đưa kiện sang trung chuyển.
              </p>
            </div>
            <ErrorSummary
              message={
                dispatchTransferMutation.isError
                  ? getApiErrorMessage(dispatchTransferMutation.error)
                  : undefined
              }
            />
            <DataTable
              caption="Danh sách chuyến trung chuyển gửi đi"
              columns={[
                {
                  id: 'transferCode',
                  header: 'Mã chuyến',
                  render: (transfer) => (
                    <span className="font-mono font-semibold text-primary">
                      {transfer.transferCode}
                    </span>
                  ),
                },
                {
                  id: 'shipment',
                  header: 'Vận đơn',
                  render: (transfer) => (
                    <div className="space-y-1.5">
                      <p className="font-mono font-medium text-ink">
                        {transfer.shipment?.trackingCode || '—'}
                      </p>
                      {transfer.shipment?.status ? (
                        <ShipmentStatusBadge status={transfer.shipment.status} />
                      ) : null}
                    </div>
                  ),
                },
                {
                  id: 'route',
                  header: 'Kho đi → kho đến',
                  render: (transfer) => (
                    <div>
                      <p className="font-medium text-ink">
                        {transfer.fromWarehouse?.code || '—'} → {transfer.toWarehouse?.code || '—'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {transfer.fromWarehouse?.name || '—'} → {transfer.toWarehouse?.name || '—'}
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'transferStatus',
                  header: 'Trạng thái chuyến',
                  render: (transfer) => <WarehouseTransferStatusBadge status={transfer.status} />,
                },
                {
                  id: 'dispatchedAt',
                  header: 'Thời điểm',
                  render: (transfer) => (
                    <div className="whitespace-nowrap text-muted-foreground">
                      <p>{transfer.dispatchedAt ? 'Đã xuất' : 'Đã tạo'}</p>
                      <p className="mt-0.5 text-xs">
                        {formatDateTime(transfer.dispatchedAt || transfer.createdAt)}
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'action',
                  header: 'Thao tác',
                  align: 'right',
                  render: (transfer) =>
                    transfer.status === 'PENDING' && transfer.lineHaulTrip ? (
                      <Link
                        className="focus-ring inline-flex min-h-11 w-full items-center justify-center rounded-control border border-border px-3 text-sm font-semibold text-primary hover:bg-primary-soft md:w-auto"
                        to={`/warehouse/line-haul/${transfer.lineHaulTrip.id}`}
                      >
                        Xuất theo {transfer.lineHaulTrip.tripCode}
                      </Link>
                    ) : transfer.status === 'PENDING' ? (
                      <Button
                        className="w-full whitespace-nowrap md:w-auto"
                        disabled={dispatchTransferMutation.isPending}
                        loading={
                          dispatchTransferMutation.isPending &&
                          dispatchTransferMutation.variables === transfer.id
                        }
                        onClick={() => setDispatchModalTransfer(transfer)}
                      >
                        Dispatch / xuất kho
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {transfer.status === 'IN_TRANSIT' ? 'Đã rời kho' : 'Đã xử lý'}
                      </span>
                    ),
                },
              ]}
              emptyDescription="Chưa có chuyến chuyển kho xuất phát từ kho này."
              emptyTitle="Chưa có chuyến gửi đi"
              error={
                outboundTransfers.isError ? getApiErrorMessage(outboundTransfers.error) : undefined
              }
              getRowKey={(transfer) => transfer.id}
              loading={outboundTransfers.isPending}
              loadingLabel="Đang tải danh sách chuyến xuất"
              onRetry={() => void outboundTransfers.refetch()}
              rows={outboundTransfers.data ?? []}
            />
          </section>
        ) : null}

        {/* TAB 4: INBOUND TRANSFERS */}
        {activeTab === 'inbound_transfers' ? (
          <section
            aria-labelledby="warehouse-tab-inbound-transfers"
            className="mt-6 space-y-4"
            id="warehouse-panel-inbound-transfers"
            role="tabpanel"
          >
            <div>
              <h2 className="text-lg font-semibold text-ink">Chuyến trung chuyển đến kho</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Xác nhận kiện đến, cân lại khi cần và hoàn tất tiếp nhận tại kho đích.
              </p>
            </div>
            <DataTable
              caption="Danh sách chuyến trung chuyển đến kho"
              columns={[
                {
                  id: 'transferCode',
                  header: 'Mã chuyến',
                  render: (transfer) => (
                    <span className="font-mono font-semibold text-primary">
                      {transfer.transferCode}
                    </span>
                  ),
                },
                {
                  id: 'shipment',
                  header: 'Vận đơn',
                  render: (transfer) => (
                    <div className="space-y-1.5">
                      <p className="font-mono font-medium text-ink">
                        {transfer.shipment?.trackingCode || '—'}
                      </p>
                      {transfer.shipment?.status ? (
                        <ShipmentStatusBadge status={transfer.shipment.status} />
                      ) : null}
                    </div>
                  ),
                },
                {
                  id: 'route',
                  header: 'Kho đi → kho đến',
                  render: (transfer) => (
                    <div>
                      <p className="font-medium text-ink">
                        {transfer.fromWarehouse?.code || '—'} → {transfer.toWarehouse?.code || '—'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {transfer.fromWarehouse?.name || '—'} → {transfer.toWarehouse?.name || '—'}
                      </p>
                    </div>
                  ),
                },
                {
                  id: 'transferStatus',
                  header: 'Trạng thái chuyến',
                  render: (transfer) => <WarehouseTransferStatusBadge status={transfer.status} />,
                },
                {
                  id: 'dispatchedAt',
                  header: 'Thời điểm xuất',
                  render: (transfer) => (
                    <span className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(transfer.dispatchedAt || transfer.createdAt)}
                    </span>
                  ),
                },
                {
                  id: 'action',
                  header: 'Thao tác',
                  align: 'right',
                  render: (transfer) =>
                    transfer.status === 'IN_TRANSIT' &&
                    (!transfer.lineHaulTrip || transfer.lineHaulTrip.status === 'ARRIVED') ? (
                      <Button
                        className="w-full whitespace-nowrap md:w-auto"
                        disabled={receiveTransferMutation.isPending}
                        onClick={() => openReceiveModal(transfer)}
                      >
                        Nhập kho đích
                      </Button>
                    ) : transfer.status === 'IN_TRANSIT' && transfer.lineHaulTrip ? (
                      <Link
                        className="focus-ring inline-flex min-h-11 w-full items-center justify-center rounded-control border border-border px-3 text-sm font-semibold text-primary hover:bg-primary-soft md:w-auto"
                        to={`/warehouse/line-haul/${transfer.lineHaulTrip.id}`}
                      >
                        Chờ {transfer.lineHaulTrip.tripCode} đến
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">Đã xử lý</span>
                    ),
                },
              ]}
              emptyDescription="Hiện không có chuyến chuyển liên kho nào đang đến."
              emptyTitle="Không có chuyến đến"
              error={
                inboundTransfers.isError ? getApiErrorMessage(inboundTransfers.error) : undefined
              }
              getRowKey={(transfer) => transfer.id}
              loading={inboundTransfers.isPending}
              loadingLabel="Đang tải danh sách chuyến đến"
              onRetry={() => void inboundTransfers.refetch()}
              rows={inboundTransfers.data ?? []}
            />
          </section>
        ) : null}

        {/* Modal: Check-in & Package Verification */}
        {checkInModalShipment ? (
          <Modal
            description="Đối chiếu khai báo với kiện thực tế trước khi xác nhận check-in."
            footer={
              <>
                <Button
                  disabled={checkInMutation.isPending}
                  variant="secondary"
                  onClick={() => setCheckInModalShipment(null)}
                >
                  Hủy
                </Button>
                <Button
                  disabled={!packageVerificationComplete}
                  loading={checkInMutation.isPending}
                  onClick={() =>
                    checkInMutation.mutate({
                      shipmentId: checkInModalShipment.id,
                      packageVerified: true,
                      actualWeightGrams: Number(checkInWeight),
                      lengthCm: Number(checkInLength),
                      widthCm: Number(checkInWidth),
                      heightCm: Number(checkInHeight),
                      note: checkInNote || undefined,
                    })
                  }
                >
                  Xác nhận nhập kho
                </Button>
              </>
            }
            onClose={() => setCheckInModalShipment(null)}
            open
            title={`Kiểm hàng & nhập kho — ${checkInModalShipment.trackingCode}`}
          >
            <div className="space-y-5">
              <ErrorSummary
                message={
                  checkInMutation.isError ? getApiErrorMessage(checkInMutation.error) : undefined
                }
              />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-control border border-border bg-surface-subtle p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Người gửi
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {checkInModalShipment.senderSnapshot?.fullName || '—'}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {checkInModalShipment.senderSnapshot?.phone || 'Không có số điện thoại'}
                  </p>
                </div>
                <div className="rounded-control border border-border bg-surface-subtle p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Người nhận
                  </p>
                  <p className="mt-1 font-semibold text-ink">
                    {checkInModalShipment.receiverSnapshot?.fullName || '—'}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {checkInModalShipment.receiverSnapshot?.phone || 'Không có số điện thoại'}
                  </p>
                </div>
              </div>

              <div className="rounded-control border border-border bg-surface-subtle p-4 text-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Kiện khai báo
                </p>
                <p className="mt-1 font-semibold text-ink">
                  {checkInModalShipment.packageSnapshot?.description || 'Hàng hóa'} ·{' '}
                  {checkInModalShipment.packageSnapshot?.packageType || 'Không phân loại'}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {formatWeight(checkInModalShipment.packageSnapshot?.weightGrams || 0)} ·{' '}
                  {checkInModalShipment.packageSnapshot?.lengthCm || 0} ×{' '}
                  {checkInModalShipment.packageSnapshot?.widthCm || 0} ×{' '}
                  {checkInModalShipment.packageSnapshot?.heightCm || 0} cm
                </p>
              </div>

              <FormField
                id="ci-weight"
                inputMode="decimal"
                label="Trọng lượng thực tế sau khi cân (gram)"
                min="1"
                placeholder="2000"
                type="number"
                value={checkInWeight}
                onChange={(event) => setCheckInWeight(event.target.value)}
              />

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  id="ci-length"
                  inputMode="decimal"
                  label="Dài (cm)"
                  min="1"
                  type="number"
                  value={checkInLength}
                  onChange={(event) => setCheckInLength(event.target.value)}
                />
                <FormField
                  id="ci-width"
                  inputMode="decimal"
                  label="Rộng (cm)"
                  min="1"
                  type="number"
                  value={checkInWidth}
                  onChange={(event) => setCheckInWidth(event.target.value)}
                />
                <FormField
                  id="ci-height"
                  inputMode="decimal"
                  label="Cao (cm)"
                  min="1"
                  type="number"
                  value={checkInHeight}
                  onChange={(event) => setCheckInHeight(event.target.value)}
                />
              </div>

              <FormField
                id="ci-note"
                label="Ghi chú ngoại quan kiện hàng"
                placeholder="Hàng nguyên seal, không móp méo..."
                value={checkInNote}
                onChange={(event) => setCheckInNote(event.target.value)}
              />

              <label className="focus-within:ring-focus flex min-h-12 cursor-pointer items-start gap-3 rounded-control border border-border bg-surface p-3 text-sm text-ink focus-within:ring-2 focus-within:ring-offset-2">
                <input
                  checked={packageVerified}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                  type="checkbox"
                  onChange={(event) => setPackageVerified(event.target.checked)}
                />
                <span>
                  <span className="block font-semibold">Đã đối chiếu kiện thực tế</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Tôi xác nhận khối lượng, kích thước và ngoại quan ở trên là kết quả kiểm tra tại
                    kho.
                  </span>
                </span>
              </label>
            </div>
          </Modal>
        ) : null}

        {/* Modal: Sorting and destination confirmation */}
        {sortingModalShipment ? (
          <Modal
            description="Xác nhận kho đi và chọn kho đích từ danh mục đang hoạt động."
            footer={
              <>
                <Button
                  disabled={routeDestinationMutation.isPending}
                  variant="secondary"
                  onClick={() => setSortingModalShipment(null)}
                >
                  Hủy
                </Button>
                <Button
                  disabled={!sortingDestWh}
                  loading={routeDestinationMutation.isPending}
                  onClick={() =>
                    routeDestinationMutation.mutate({
                      shipmentId: sortingModalShipment.id,
                      destinationWarehouseId: sortingDestWh,
                    })
                  }
                >
                  Xác nhận phân loại
                </Button>
              </>
            }
            onClose={() => setSortingModalShipment(null)}
            open
            title={`Phân loại — ${sortingModalShipment.trackingCode}`}
          >
            <div className="space-y-5">
              <ErrorSummary
                message={
                  routeDestinationMutation.isError
                    ? getApiErrorMessage(routeDestinationMutation.error)
                    : undefined
                }
              />
              <div className="rounded-control border border-border bg-surface-subtle p-4 text-sm">
                <p className="text-muted-foreground">Kho đi</p>
                <p className="mt-1 font-semibold text-ink">
                  {activeWarehouse?.code || '—'} · {activeWarehouse?.name || '—'}
                </p>
              </div>
              <SelectField
                id="sorting-destination"
                label="Kho đích"
                value={sortingDestWh}
                onChange={(event) => setSortingDestWh(event.target.value)}
              >
                {allWarehouses.data?.items?.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.code} - {warehouse.name} ({warehouse.address})
                  </option>
                ))}
              </SelectField>
              {sortingDestWh === activeWarehouseId ? (
                <p className="rounded-control border border-primary/30 bg-primary-soft p-3 text-sm text-primary-strong">
                  Kho đích trùng kho hiện tại; xác nhận sẽ chuyển thẳng sang chờ phân công giao
                  hàng, không tạo transfer liên kho.
                </p>
              ) : null}
            </div>
          </Modal>
        ) : null}

        {/* Modal: Create Transfer */}
        {transferModalShipment ? (
          <Modal
            description="Create tạo bản ghi chờ xuất. Kiện chỉ rời inventory sau khi Dispatch."
            footer={
              <>
                <Button variant="secondary" onClick={() => setTransferModalShipment(null)}>
                  Hủy
                </Button>
                <Button
                  disabled={
                    !transferModalShipment.destinationWarehouseId || !transferClientRequestId
                  }
                  loading={transferMutation.isPending}
                  onClick={() =>
                    transferMutation.mutate({
                      shipmentId: transferModalShipment.id,
                      toWarehouseId: transferModalShipment.destinationWarehouseId || '',
                      note: transferNote || undefined,
                      clientRequestId: transferClientRequestId,
                    })
                  }
                >
                  Tạo transfer chờ xuất
                </Button>
              </>
            }
            onClose={() => setTransferModalShipment(null)}
            open
            title={`Tạo chuyến liên kho — ${transferModalShipment.trackingCode}`}
          >
            <div className="space-y-5">
              <ErrorSummary
                message={
                  transferMutation.isError ? getApiErrorMessage(transferMutation.error) : undefined
                }
              />

              <div className="rounded-control border border-border bg-surface-subtle p-4 text-sm">
                <p className="text-muted-foreground">Kho đi → kho đến đã xác nhận</p>
                <p className="mt-1 font-semibold text-ink">
                  {activeWarehouse?.code || '—'} · {activeWarehouse?.name || '—'} →{' '}
                  {transferModalShipment.destinationWarehouse?.code || '—'} ·{' '}
                  {transferModalShipment.destinationWarehouse?.name || '—'}
                </p>
              </div>

              <FormField
                id="trf-note"
                label="Ghi chú vận hành (tùy chọn)"
                placeholder="Ca trung chuyển đêm, ưu tiên hàng dễ vỡ..."
                value={transferNote}
                onChange={(event) => setTransferNote(event.target.value)}
              />
            </div>
          </Modal>
        ) : null}

        {/* Modal: Dispatch confirmation */}
        {dispatchModalTransfer ? (
          <Modal
            description="Xác nhận kiện đã bàn giao khỏi kho. Sau bước này Shipment chuyển sang IN_TRANSIT."
            footer={
              <>
                <Button
                  disabled={dispatchTransferMutation.isPending}
                  variant="secondary"
                  onClick={() => setDispatchModalTransfer(null)}
                >
                  Quay lại
                </Button>
                <Button
                  loading={dispatchTransferMutation.isPending}
                  onClick={() => dispatchTransferMutation.mutate(dispatchModalTransfer.id)}
                >
                  Xác nhận Dispatch
                </Button>
              </>
            }
            onClose={() => setDispatchModalTransfer(null)}
            open
            title={`Xuất kho — ${dispatchModalTransfer.transferCode}`}
          >
            <div className="space-y-4">
              <ErrorSummary
                message={
                  dispatchTransferMutation.isError
                    ? getApiErrorMessage(dispatchTransferMutation.error)
                    : undefined
                }
              />
              <div className="rounded-control border border-border bg-surface-subtle p-4 text-sm">
                <p className="text-muted-foreground">Mã vận đơn</p>
                <p className="mt-1 font-mono font-semibold text-ink">
                  {dispatchModalTransfer.shipment?.trackingCode || '—'}
                </p>
                <p className="mt-4 text-muted-foreground">Kho đi → kho đến</p>
                <p className="mt-1 font-semibold text-ink">
                  {dispatchModalTransfer.fromWarehouse?.code || '—'} ·{' '}
                  {dispatchModalTransfer.fromWarehouse?.name || '—'} →{' '}
                  {dispatchModalTransfer.toWarehouse?.code || '—'} ·{' '}
                  {dispatchModalTransfer.toWarehouse?.name || '—'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <WarehouseTransferStatusBadge status={dispatchModalTransfer.status} />
                  {dispatchModalTransfer.shipment?.status ? (
                    <ShipmentStatusBadge status={dispatchModalTransfer.shipment.status} />
                  ) : null}
                </div>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Dispatch sẽ xóa vị trí kho hiện tại của Shipment trong thời gian trung chuyển. Kho
                đích phải Receive để đưa kiện trở lại inventory.
              </p>
            </div>
          </Modal>
        ) : null}

        {/* Modal: Receive Transfer */}
        {receiveModalTransfer ? (
          <Modal
            description="Đối chiếu nguồn gửi và xác nhận kiện đã đến đúng kho đích."
            footer={
              <>
                <Button
                  disabled={receiveTransferMutation.isPending}
                  variant="secondary"
                  onClick={() => setReceiveModalTransfer(null)}
                >
                  Hủy
                </Button>
                <Button
                  loading={receiveTransferMutation.isPending}
                  onClick={() =>
                    receiveTransferMutation.mutate({
                      transferId: receiveModalTransfer.id,
                      note: receiveNote || undefined,
                      actualWeightGrams: receiveWeight ? Number(receiveWeight) : undefined,
                    })
                  }
                >
                  Xác nhận nhập kho đích
                </Button>
              </>
            }
            onClose={() => setReceiveModalTransfer(null)}
            open
            title={`Nhận trung chuyển — ${receiveModalTransfer.transferCode}`}
          >
            <div className="space-y-5">
              <ErrorSummary
                message={
                  receiveTransferMutation.isError
                    ? getApiErrorMessage(receiveTransferMutation.error)
                    : undefined
                }
              />

              <div className="rounded-control border border-border bg-surface-subtle p-4 text-sm">
                <p className="text-muted-foreground">Kho đi → kho đến</p>
                <p className="mt-1 font-semibold text-ink">
                  {receiveModalTransfer.fromWarehouse?.name || '—'} (
                  {receiveModalTransfer.fromWarehouse?.code || '—'}) →{' '}
                  {receiveModalTransfer.toWarehouse?.name || '—'} (
                  {receiveModalTransfer.toWarehouse?.code || '—'})
                </p>
                <p className="mt-2 text-muted-foreground">
                  Mã vận đơn:{' '}
                  <span className="font-mono font-semibold text-ink">
                    {receiveModalTransfer.shipment?.trackingCode || '—'}
                  </span>
                </p>
              </div>

              <FormField
                id="rcv-weight"
                inputMode="decimal"
                label="Cân lại tại kho đích (gram, tùy chọn)"
                min="1"
                placeholder="2000"
                type="number"
                value={receiveWeight}
                onChange={(event) => setReceiveWeight(event.target.value)}
              />

              <FormField
                id="rcv-note"
                label="Ghi chú khi nhận"
                placeholder="Đã nhận đủ hàng, nguyên đai nguyên kiện..."
                value={receiveNote}
                onChange={(event) => setReceiveNote(event.target.value)}
              />
            </div>
          </Modal>
        ) : null}
      </div>
    </AccountLayout>
  );
}
