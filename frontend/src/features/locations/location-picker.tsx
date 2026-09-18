import { useCallback, useState } from 'react';
import { Button } from '../../components/ui/button';
import { hasValidCoordinates } from './driver-task-map-model';
import { LocationMap } from './location-map';
import { resolveAddressViewport, type LocationAddressContext } from './location-viewport';
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
  return <LocationPickerSession key={getAddressFingerprint(props.addressContext ?? {})} {...props} />;
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
  const selectedValue = getConfirmedCoordinate(value, confirmedAddressFingerprint, addressContext);
  const stale = isLocationStale(confirmedAddressFingerprint, addressContext);
  const select = useCallback((point: Coordinate) => {
    if (hasValidCoordinates(point)) setDraft(point);
  }, []);
  return (
    <section aria-label={label} className="space-y-3 rounded-control border border-border p-4">
      <p className="font-semibold text-ink">{label}</p>
      {stale && <p role="alert" className="text-sm font-medium text-warning">{STALE_LOCATION_MESSAGE}</p>}
      <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
        {selectedValue ? `${selectedValue.latitude.toFixed(6)}, ${selectedValue.longitude.toFixed(6)}` : 'Chưa chọn vị trí'}
      </p>
      {!open ? (
        <Button
          disabled={disabled}
          variant="secondary"
          onClick={() => {
            setDraft(selectedValue);
            setOpen(true);
          }}
        >
          {selectedValue ? 'Thay đổi vị trí' : 'Chọn vị trí trên bản đồ'}
        </Button>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Click bản đồ để đặt ghim, kéo ghim để chỉnh. Với bàn phím: dùng phím mũi tên di chuyển
            bản đồ, Enter chọn tâm bản đồ.
          </p>
          <LocationMap
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
              disabled={disabled || !draft}
              onClick={() => {
                if (draft) {
                  onChange(draft, getAddressFingerprint(addressContext));
                  setOpen(false);
                }
              }}
            >
              Xác nhận vị trí
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Hủy
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
