import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { hasValidCoordinates } from './driver-task-map-model';
import { LocationMap } from './location-map';
import { AddressSearch } from './address-search';
import { isFarFromSelectedArea, resolveAddressViewport, type LocationAddressContext } from './location-viewport';
import { browserLocationErrorMessage, locateBrowserPosition } from './browser-location';
import { getAddressFingerprint, getConfirmedCoordinate, isLocationStale, STALE_LOCATION_MESSAGE, type Coordinate } from '../addresses/address-location-model';

type LocationPickerProps = {
  value?: Coordinate;
  confirmedAddressFingerprint?: string;
  onChange: (value: Coordinate, fingerprint: string) => void;
  label: string;
  disabled?: boolean;
  addressContext?: LocationAddressContext;
};

export function LocationPicker(props: LocationPickerProps) {
  // A changed address also discards an unconfirmed draft from an open map.
  return <LocationPickerSession key={`${getAddressFingerprint(props.addressContext ?? {})}:${Boolean(props.disabled)}`} {...props} />;
}

function LocationPickerSession({
  value,
  onChange,
  label,
  disabled = false,
  addressContext = {},
  confirmedAddressFingerprint,
}: LocationPickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Coordinate>();
  const [mapSession, setMapSession] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [gpsDraft, setGpsDraft] = useState(false);
  const locationRequest = useRef(0);
  useEffect(() => () => { locationRequest.current += 1; }, []);
  const cancelLocationRequest = () => {
    locationRequest.current += 1;
    setLocating(false);
    setLocationError('');
  };
  async function requestCurrentLocation() {
    if (disabled || locating) return;
    const request = ++locationRequest.current;
    setLocating(true);
    setLocationError('');
    try {
      const sample = await locateBrowserPosition();
      if (request !== locationRequest.current) return;
      if (!hasValidCoordinates(sample)) throw new Error('Invalid device coordinates');
      setDraft({ latitude: Number(sample.latitude.toFixed(6)), longitude: Number(sample.longitude.toFixed(6)) });
      setGpsDraft(true);
      setMapSession((session) => session + 1);
      setOpen(true);
    } catch (error) {
      if (request === locationRequest.current) setLocationError(browserLocationErrorMessage(error));
    } finally {
      if (request === locationRequest.current) setLocating(false);
    }
  }
  const selectedValue = getConfirmedCoordinate(value, confirmedAddressFingerprint, addressContext);
  const stale = isLocationStale(confirmedAddressFingerprint, addressContext);
  const select = useCallback((point: Coordinate) => {
    locationRequest.current += 1;
    setLocating(false);
    setLocationError('');
    if (hasValidCoordinates(point)) setDraft(point);
  }, []);
  return (
    <section aria-label={label} className="space-y-3 rounded-control border border-border p-4">
      <p className="font-semibold text-ink">{label}</p>
      {stale && <p role="alert" className="text-sm font-medium text-warning">{STALE_LOCATION_MESSAGE}</p>}
      <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
        {selectedValue ? `${selectedValue.latitude.toFixed(6)}, ${selectedValue.longitude.toFixed(6)}` : 'Chưa chọn vị trí'}
      </p>
      <AddressSearch address={addressContext} disabled={disabled}
        actions={<Button variant="secondary" disabled={disabled} loading={locating} aria-busy={locating}
          onClick={() => void requestCurrentLocation()}>{locating ? 'Đang lấy vị trí...' : 'Dùng vị trí hiện tại'}</Button>}
        onSelect={(result) => {
        if (!hasValidCoordinates(result)) return;
        cancelLocationRequest();
        setGpsDraft(false);
        setDraft({ latitude: result.latitude, longitude: result.longitude });
        setMapSession((session) => session + 1);
        setOpen(true);
      }} />
      {locating && <p role="status" className="text-sm text-muted-foreground">Đang lấy vị trí...</p>}
      {locationError && <p role="alert" className="text-sm text-warning">{locationError}</p>}
      {!open ? (
        <Button
          disabled={disabled}
          variant="secondary"
          onClick={() => {
            cancelLocationRequest();
            setGpsDraft(false);
            setDraft(selectedValue);
            setOpen(true);
          }}
        >
          {selectedValue ? 'Thay đổi vị trí' : 'Chọn vị trí trên bản đồ'}
        </Button>
      ) : (
        <>
          {gpsDraft && draft && isFarFromSelectedArea(draft, addressContext) && (
            <p role="alert" className="text-sm font-medium text-warning">Vị trí hiện tại có vẻ không khớp khu vực hành chính đã chọn. Hãy kiểm tra lại Tỉnh/Thành phố và Phường/Xã.</p>
          )}
          <p className="text-sm text-muted-foreground">
            Click bản đồ để đặt ghim, kéo ghim để chỉnh. Với bàn phím: dùng phím mũi tên di chuyển
            bản đồ, Enter chọn tâm bản đồ.
          </p>
          <LocationMap
            key={mapSession}
            ariaLabel={label}
            initialViewport={resolveAddressViewport(addressContext)}
            markers={draft ? [{ ...draft, id: 'selection', label }] : []}
            onSelect={select}
          />
          <p role="status" className="text-sm tabular-nums">
            {draft
              ? `${draft.latitude.toFixed(6)}, ${draft.longitude.toFixed(6)}`
              : 'Chọn một điểm trước khi xác nhận.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={disabled || locating || !draft}
              onClick={() => {
                if (draft) {
                  cancelLocationRequest();
                  onChange(draft, getAddressFingerprint(addressContext));
                  setOpen(false);
                }
              }}
            >
              Xác nhận vị trí
            </Button>
            <Button variant="secondary" onClick={() => { cancelLocationRequest(); setOpen(false); }}>
              Hủy
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
