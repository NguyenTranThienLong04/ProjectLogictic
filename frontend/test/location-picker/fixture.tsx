import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { LocationPicker } from '../../src/features/locations/location-picker';
import { getAddressFingerprint } from '../../src/features/addresses/address-location-model';
export function Check() {
  const params = new URLSearchParams(window.location.search);
  const [value, setValue] = useState<{ latitude: number; longitude: number } | undefined>(() =>
    params.has('lat') || params.has('lng')
      ? { latitude: Number(params.get('lat') ?? NaN), longitude: Number(params.get('lng') ?? NaN) }
      : undefined,
  );
  const [city, setCity] = useState(params.get('city') ?? '');
  const address = { street: '123 Nguyễn Trãi', ward: params.get('ward') ?? '', district: '', city };
  const [fingerprint, setFingerprint] = useState(() => value ? getAddressFingerprint(address) : undefined);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        throw new Error('Unexpected submit');
      }}
    >
      {params.has('viewport') && <label>Thành phố<input aria-label="Thành phố" value={city} onChange={(event) => setCity(event.target.value)} /></label>}
      <LocationPicker label="Vị trí" value={value} confirmedAddressFingerprint={fingerprint}
        onChange={(point, confirmed) => { setValue(point); setFingerprint(confirmed); }} addressContext={address} />
      <output>{JSON.stringify(value)}</output>
    </form>
  );
}
createRoot(document.getElementById('root')!).render(<Check />);
