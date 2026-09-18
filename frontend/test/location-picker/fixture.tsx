import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles.css';
import { LocationPicker } from '../../src/features/locations/location-picker';
export function Check() {
  const [value, setValue] = useState<{ latitude: number; longitude: number }>();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        throw new Error('Unexpected submit');
      }}
    >
      <LocationPicker label="Vị trí" value={value} onChange={setValue} />
      <output>{JSON.stringify(value)}</output>
    </form>
  );
}
createRoot(document.getElementById('root')!).render(<Check />);
