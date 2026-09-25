import { z } from 'zod';
import { getAddressFingerprint, getConfirmedCoordinate, STALE_LOCATION_MESSAGE } from '../addresses/address-location-model.ts';
import { isCanonicalAddress } from '../addresses/administrative-model.ts';
import type { Warehouse } from './warehouse-types';

export const warehouseAddressContext = (value: { address: string; city: string; ward: string; district: string }) =>
  ({ street: value.address, city: value.city, ward: value.ward, district: value.district });

export const warehouseFormSchema = z.object({
  code: z.string().trim().min(2).max(32).regex(/^[A-Z0-9_-]+$/, 'Mã kho chỉ gồm chữ HOA, số, gạch ngang hoặc gạch dưới'),
  name: z.string().trim().min(2, 'Tên kho tối thiểu 2 ký tự').max(100),
  address: z.string().trim().min(5, 'Nhập số nhà, tên đường (tối thiểu 5 ký tự)').max(255),
  city: z.string().trim().min(2, 'Chọn tỉnh/thành phố').max(100),
  ward: z.string().trim().max(100),
  district: z.string().trim().max(100),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  confirmedAddressFingerprint: z.string().optional(),
  originalAddressFingerprint: z.string().optional(),
}).superRefine((value, ctx) => {
  const address = warehouseAddressContext(value);
  const unchanged = value.originalAddressFingerprint === getAddressFingerprint(address);
  if (!unchanged && !isCanonicalAddress(value.city, value.ward)) {
    ctx.addIssue({ code: 'custom', path: ['ward'], message: 'Chọn phường/xã thuộc tỉnh/thành hiện tại' });
  }
  if ((!unchanged || value.latitude !== undefined || value.longitude !== undefined) &&
    !getConfirmedCoordinate(value.latitude !== undefined && value.longitude !== undefined
      ? { latitude: value.latitude, longitude: value.longitude } : undefined, value.confirmedAddressFingerprint, address)) {
    ctx.addIssue({ code: 'custom', path: ['confirmedAddressFingerprint'], message: value.confirmedAddressFingerprint ? STALE_LOCATION_MESSAGE : 'Vui lòng chọn và xác nhận vị trí trên bản đồ.' });
  }
});

export type WarehouseFormValues = z.infer<typeof warehouseFormSchema>;
export const emptyWarehouseForm: WarehouseFormValues = { code: '', name: '', address: '', city: '', ward: '', district: '' };

export function warehouseFormValues(warehouse: Warehouse): WarehouseFormValues {
  const value = { code: warehouse.code, name: warehouse.name, address: warehouse.address,
    city: warehouse.city, ward: warehouse.ward ?? '', district: warehouse.district ?? '',
    latitude: warehouse.latitude ?? undefined, longitude: warehouse.longitude ?? undefined };
  const fingerprint = getAddressFingerprint(warehouseAddressContext(value));
  return { ...value, originalAddressFingerprint: fingerprint, confirmedAddressFingerprint: fingerprint };
}

export function warehouseFormInput(values: WarehouseFormValues) {
  const value = warehouseFormSchema.parse(values);
  return { code: value.code, name: value.name, address: value.address, city: value.city,
    ward: value.ward, district: value.district, latitude: value.latitude, longitude: value.longitude };
}
