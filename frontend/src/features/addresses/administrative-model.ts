import dataset from './data/vietnam-admin.json' with { type: 'json' };
import { normalizeAddressText } from './address-location-model.ts';

export const provinces = dataset.provinces;
export const wards = dataset.wards;
export type Province = typeof provinces[number];
export type Ward = typeof wards[number];

export function normalizeAdministrativeSearch(value: string): string {
  return normalizeAddressText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

function provinceKey(value: string): string {
  return normalizeAdministrativeSearch(value).replace(/[^a-z0-9]/g, '')
    .replace(/^(thanhpho|tinh|tp)/, '').replace(/city$/, '');
}

export function findProvince(value = ''): Province | undefined {
  const key = provinceKey(value);
  if (['hcm', 'saigon'].includes(key)) return provinces.find((province) => province.code === '79');
  return provinces.find((province) => provinceKey(province.name) === key);
}

export function getProvinceWards(provinceCode?: string): Ward[] {
  return provinceCode ? wards.filter((ward) => ward.provinceCode === provinceCode) : [];
}

export function findWard(provinceCode: string | undefined, value = ''): Ward | undefined {
  const key = normalizeAdministrativeSearch(value).replace(/^(phuong|xa|dac khu)\s+/, '');
  return getProvinceWards(provinceCode).find((ward) => normalizeAdministrativeSearch(ward.name) === key);
}

export function isCanonicalAddress(city?: string, ward?: string): boolean {
  return Boolean(findWard(findProvince(city)?.code, ward));
}
