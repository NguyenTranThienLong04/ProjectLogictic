import { SearchableSelect } from '../../components/ui/searchable-select';
import { findProvince, findWard, getProvinceWards, normalizeAdministrativeSearch, provinces } from './administrative-model';

export function AdministrativeAddressFields({ city = '', ward = '', onChange, cityError, wardError, disabled }: {
  city?: string;
  ward?: string;
  onChange: (address: { city: string; ward: string; district: string }) => void;
  cityError?: string;
  wardError?: string;
  disabled?: boolean;
}) {
  const province = findProvince(city);
  const selectedWard = findWard(province?.code, ward);
  const choices = getProvinceWards(province?.code);
  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <SearchableSelect label="Tỉnh / thành phố" value={province?.code ?? ''}
          placeholder="Tìm tỉnh/thành..." error={cityError} disabled={disabled}
          options={provinces.map((item) => ({ value: item.code, label: item.name, searchText: item.name }))}
          normalizeSearch={normalizeAdministrativeSearch}
          onChange={(code) => {
            if (code === province?.code) return;
            const next = provinces.find((item) => item.code === code);
            if (next) onChange({ city: next.name, ward: '', district: '' });
          }} />
        <SearchableSelect key={province?.code ?? 'none'} label="Phường / xã" value={selectedWard?.code ?? ''}
          placeholder={province ? 'Chọn phường/xã...' : 'Chọn tỉnh/thành trước'} error={wardError}
          disabled={disabled || !province} normalizeSearch={normalizeAdministrativeSearch}
          options={choices.map((item) => ({ value: item.code, label: item.name, searchText: item.name }))}
          onChange={(code) => {
            if (code === selectedWard?.code) return;
            const next = choices.find((item) => item.code === code);
            if (next && province) onChange({ city: province.name, ward: next.name, district: '' });
          }} />
      </div>
      {(city && !province || ward && !selectedWard) && <p className="text-sm text-muted-foreground">
        Địa chỉ cũ: {[ward, city].filter(Boolean).join(', ')}. Giữ nguyên khi chỉ sửa liên hệ; chọn lại tỉnh/thành và phường/xã nếu đổi địa chỉ.
      </p>}
      <p className="text-xs text-muted-foreground">
        Dữ liệu hành chính: <a className="underline" href="https://github.com/open-admin-data/vietnam-administrative-divisions/tree/54cdb052284b02e75dfaa44089ca383aa12c57db">Open Admin Data</a> © 2026 jakkrapongt,
        {' '}<a className="underline" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> (đã rút gọn).
        {' '}Tọa độ tham khảo: © <a className="underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors (ODbL)</a>.
      </p>
    </div>
  );
}
