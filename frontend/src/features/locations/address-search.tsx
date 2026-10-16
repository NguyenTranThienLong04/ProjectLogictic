import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isAxiosError } from 'axios';
import { Button } from '../../components/ui/button';
import { searchAddress, type AddressSearchResult } from './location-api';
import type { LocationAddressContext } from './location-viewport';
import { findProvince, findWard } from '../addresses/administrative-model';

export function AddressSearch({ address, disabled, onSelect, actions }: {
  actions?: ReactNode;
  address: LocationAddressContext;
  disabled: boolean;
  onSelect: (result: AddressSearchResult) => void;
}) {
  const [results, setResults] = useState<AddressSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [failure, setFailure] = useState('');
  const pending = useRef<AbortController | null>(null);
  const province = findProvince(address.city);
  const ward = findWard(province?.code, address.ward);
  const validArea = Boolean(province && (!address.ward || ward));
  useEffect(() => () => { pending.current?.abort(); }, []);

  async function search() {
    if (pending.current || disabled || !address.street || !address.city || !validArea) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setEmpty(false);
    setFailure('');
    setResults([]);
    try {
      const next = await searchAddress({ street: address.street, ward: address.ward, district: address.district, city: address.city }, controller.signal);
      if (controller.signal.aborted) return;
      setResults(next.slice(0, 5));
      setEmpty(next.length === 0);
    } catch (error) {
      if (!controller.signal.aborted) setFailure(isAxiosError(error) && error.response?.status === 429
        ? 'Đã đạt giới hạn tìm địa chỉ. Vui lòng chờ một lúc hoặc đặt pin thủ công.'
        : 'Không thể tìm địa chỉ lúc này. Hãy thử lại hoặc đặt pin thủ công.');
    } finally {
      if (!controller.signal.aborted) { setLoading(false); pending.current = null; }
    }
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3">
    <Button variant="secondary" loading={loading}
      disabled={disabled || (address.street?.trim().length ?? 0) < 3 || !validArea}
      onClick={() => void search()}>Tìm địa chỉ</Button>
    {actions}
    </div>
    <p className="text-sm text-muted-foreground">
      <a className="focus-ring text-primary underline" href="https://locationiq.com" target="_blank" rel="noreferrer">Search by LocationIQ.com</a>
    </p>
    <div aria-live="polite">
      {loading && <p className="text-sm text-muted-foreground">Đang tìm vị trí phù hợp...</p>}
      {empty && <p className="text-sm text-muted-foreground">Không tìm thấy địa chỉ chính xác. Bạn có thể đặt pin thủ công trong khu vực đã chọn.</p>}
      {failure && <p className="text-sm text-muted-foreground">{failure}</p>}
      {results.length > 0 && <p className="text-sm text-muted-foreground">Chọn một kết quả, kiểm tra ghim rồi xác nhận vị trí. Tỉnh/phường đã chọn được giữ nguyên.</p>}
    </div>
    {results.length > 0 && <ul aria-label="Kết quả tìm địa chỉ" className="space-y-2">
      {results.map((result, index) => <li key={`${result.id}-${index}`}>
        <Button variant="secondary" className="w-full justify-start whitespace-normal break-words text-left" disabled={disabled || loading}
          onClick={() => onSelect(result)}>
          <span className="min-w-0 space-y-1 py-2">
            <span className="block">{result.displayName}</span>
            {result.providerLocality && <span className="block text-sm font-normal text-muted-foreground">Khu vực theo bản đồ: {result.providerLocality}</span>}
            <span className="block text-sm font-normal tabular-nums text-muted-foreground">{result.latitude.toFixed(6)}, {result.longitude.toFixed(6)}</span>
            {result.precision === 'STREET' && <span className="block text-sm font-normal text-warning">Vị trí gần đúng trên đường, chưa xác định số nhà. Hãy chỉnh ghim trước khi xác nhận.</span>}
            {result.administrativeMismatch && <span className="block text-sm font-normal text-muted-foreground">Tên khu vực trên bản đồ khác lựa chọn của bạn. Hãy kiểm tra ghim.</span>}
          </span>
        </Button>
      </li>)}
    </ul>}
  </div>;
}
