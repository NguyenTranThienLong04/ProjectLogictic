import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getAccessToken } from '../../services/auth-session';
import { createOperationsSocket } from '../../services/operations-socket';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { LoadingState } from '../../components/ui/loading-state';
import { LocationMap } from './location-map';
import { getShipmentLocation } from './location-api';
import type { DriverLocation } from './location-types';

export function ShipmentLocationMap({ shipmentId }: { shipmentId: string }) {
  const queryClient = useQueryClient();
  const location = useQuery({
    queryKey: ['shipment-location', shipmentId],
    queryFn: () => getShipmentLocation(shipmentId),
  });

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const socket = createOperationsSocket();
    socket.on('connect', () => {
      socket.emit('shipment.subscribe', { shipmentId });
      void queryClient.invalidateQueries({ queryKey: ['shipment-location', shipmentId] });
      void queryClient.invalidateQueries({ queryKey: ['shipment', shipmentId] });
    });
    socket.on('driver.location.updated', (payload: DriverLocation) => {
      queryClient.setQueryData(['shipment-location', shipmentId], payload);
    });
    socket.on('shipment.updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['shipment', shipmentId] });
      void queryClient.invalidateQueries({ queryKey: ['shipment-location', shipmentId] });
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient, shipmentId]);

  if (location.isPending) return <LoadingState compact label="Đang tải vị trí tài xế" />;
  if (location.isError) {
    return (
      <ErrorState
        compact
        message="Kết nối vị trí đang gián đoạn. Hãy thử tải lại."
        onRetry={() => location.refetch()}
        title="Không thể tải vị trí"
      />
    );
  }
  if (!location.data) {
    return (
      <EmptyState
        compact
        description="Vị trí sẽ xuất hiện khi tài xế gửi cập nhật mới."
        title="Đang chờ vị trí tài xế"
      />
    );
  }
  return (
    <LocationMap
      markers={[{ ...location.data, id: location.data.driverId, label: 'Tài xế đang giao hàng' }]}
    />
  );
}
