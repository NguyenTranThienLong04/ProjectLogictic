import { useCallback, useState } from 'react';
import { Button } from '../../components/ui/button';
import { hasValidCoordinates } from './driver-task-map-model';
import { LocationMap } from './location-map';

type Coordinate = { latitude: number; longitude: number };

export function LocationPicker({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value?: Coordinate;
  onChange: (value: Coordinate) => void;
  label: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Coordinate>();
  const select = useCallback((point: Coordinate) => {
    if (hasValidCoordinates(point)) setDraft(point);
  }, []);
  return (
    <section aria-label={label} className="space-y-3 rounded-control border border-border p-4">
      <p className="font-semibold text-ink">{label}</p>
      <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
        {value ? `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}` : 'Chưa chọn vị trí'}
      </p>
      {!open ? (
        <Button
          disabled={disabled}
          variant="secondary"
          onClick={() => {
            setDraft(value);
            setOpen(true);
          }}
        >
          {value ? 'Thay đổi vị trí' : 'Chọn vị trí trên bản đồ'}
        </Button>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Click bản đồ để đặt ghim, kéo ghim để chỉnh. Với bàn phím: dùng phím mũi tên di chuyển
            bản đồ, Enter chọn tâm bản đồ.
          </p>
          <LocationMap
            ariaLabel={label}
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
                  onChange(draft);
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
