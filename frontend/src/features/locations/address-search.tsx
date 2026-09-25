import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { searchAddress, type AddressSearchResult } from './location-api';
import type { LocationAddressContext } from './location-viewport';
import { findProvince, findWard } from '../addresses/administrative-model';

export function AddressSearch({ address, disabled, onSelect }: {
  address: LocationAddressContext;
  disabled: boolean;
  onSelect: (result: AddressSearchResult) => void;
}) {
  const [results, setResults] = useState<AddressSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const province = findProvince(address.city);
  const ward = findWard(province?.code, address.ward);
  useEffect(() => () => { pending.current?.abort(); }, []);

  async function search() {
    if (pending.current || disabled || !address.street || !address.city || !address.ward || !ward) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setEmpty(false);
    setFailed(false);
    setResults([]);
    try {
      const next = await searchAddress({ street: address.street, ward: address.ward, district: address.district, city: address.city }, controller.signal);
      if (controller.signal.aborted) return;
      setResults(next.slice(0, 5));
      setEmpty(next.length === 0);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) { setLoading(false); pending.current = null; }
    }
  }

  return <div className="space-y-3">
    <Button variant="secondary" loading={loading}
      disabled={disabled || (address.street?.trim().length ?? 0) < 3 || !ward}
      onClick={() => void search()}>Tìm địa chỉ</Button>
    <p className="text-sm text-muted-foreground">
      <a className="focus-ring text-primary underline" href="https://locationiq.com" target="_blank" rel="noreferrer">Search by LocationIQ.com</a>
    </p>
    <div aria-live="polite">
      {empty && <p className="text-sm text-muted-foreground">Không tìm thấy địa chỉ phù hợp với {ward?.fullName}, {province?.name}. Hãy thử địa chỉ khác hoặc đặt pin thủ công.</p>}
      {failed && <p className="text-sm text-muted-foreground">Không thể tìm địa chỉ lúc này. Hãy thử lại hoặc đặt pin thủ công.</p>}
      {results.length > 0 && <p className="text-sm text-muted-foreground">Chọn một kết quả, kiểm tra ghim rồi xác nhận vị trí.</p>}
    </div>
    {results.length > 0 && <ul aria-label="Kết quả tìm địa chỉ" className="space-y-2">
      {results.map((result, index) => <li key={`${result.id}-${index}`}>
        <Button variant="secondary" className="w-full whitespace-normal break-words text-left" disabled={disabled || loading}
          onClick={() => onSelect(result)}>{result.displayName}</Button>
      </li>)}
    </ul>}
  </div>;
}
