import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { LocationPicker } from '../../src/features/locations/location-picker';
export function Check() {
  const params = new URLSearchParams(window.location.search);
  const [value, setValue] = useState<{ latitude: number; longitude: number } | undefined>(() =>
    params.has('lat') || params.has('lng')
      ? { latitude: Number(params.get('lat') ?? NaN), longitude: Number(params.get('lng') ?? NaN) }
      : undefined,
  );
  const [city, setCity] = useState(params.get('city') ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        throw new Error('Unexpected submit');
      }}
    >
      {params.has('viewport') && <label>Thành phố<input aria-label="Thành phố" value={city} onChange={(event) => setCity(event.target.value)} /></label>}
      <LocationPicker label="Vị trí" value={value} onChange={setValue}
        addressContext={{ street: '123 Nguyễn Trãi', ward: 'Bến Thành', district: 'Quận 1', city }} />
      <output>{JSON.stringify(value)}</output>
    </form>
  );
}
createRoot(document.getElementById('root')!).render(<Check />);
