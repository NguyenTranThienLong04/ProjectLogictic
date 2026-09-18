import { z } from 'zod';
import { getAddressFingerprint, getConfirmedCoordinate, savedAddressContext, STALE_LOCATION_MESSAGE } from './address-location-model.ts';
import { isCanonicalAddress } from './administrative-model.ts';
import type { AddressInput } from './address-api';

const phonePattern = /^\+?[0-9][0-9\s-]{7,18}[0-9]$/;
export const addressSchema = z.object({
  label: z.string().trim().min(1, 'Nhập tên gợi nhớ').max(50, 'Tối đa 50 ký tự'),
  contactName: z.string().trim().min(2, 'Tên liên hệ cần ít nhất 2 ký tự').max(100),
  phone: z.string().trim().regex(phonePattern, 'Số điện thoại không đúng định dạng'),
  streetAddress: z.string().trim().min(3, 'Địa chỉ cần ít nhất 3 ký tự').max(255),
  ward: z.string().trim().min(2, 'Chọn phường/xã').max(100),
  district: z.string().trim().max(100),
  city: z.string().trim().min(2, 'Chọn tỉnh/thành phố').max(100),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  confirmedAddressFingerprint: z.string().optional(),
  originalAddressFingerprint: z.string().optional(),
  isDefault: z.boolean(),
}).superRefine((values, context) => {
  const address = savedAddressContext(values);
  const unchangedLegacy = values.originalAddressFingerprint === getAddressFingerprint(address);
  if (!unchangedLegacy && !isCanonicalAddress(values.city, values.ward)) {
    context.addIssue({ code: 'custom', message: 'Chọn phường/xã thuộc tỉnh/thành hiện tại', path: ['ward'] });
  }
  if ((values.latitude !== undefined || values.longitude !== undefined) && !confirmedAddressCoordinate(values)) {
    context.addIssue({ code: 'custom', message: STALE_LOCATION_MESSAGE, path: ['confirmedAddressFingerprint'] });
  }
});

export type AddressFormValues = z.infer<typeof addressSchema>;

function confirmedAddressCoordinate(values: AddressFormValues) {
  return getConfirmedCoordinate(values.latitude !== undefined && values.longitude !== undefined
    ? { latitude: values.latitude, longitude: values.longitude } : undefined,
  values.confirmedAddressFingerprint, savedAddressContext(values));
}

export function addressFormInput(values: AddressFormValues): AddressInput {
  // Also validate at the serialization boundary; never omit stale coords in a PATCH
  // since omission would preserve the old coordinates in the database.
  const valid = addressSchema.parse(values);
  return { label: valid.label, contactName: valid.contactName, phone: valid.phone,
    streetAddress: valid.streetAddress, ward: valid.ward, district: valid.district,
    city: valid.city, isDefault: valid.isDefault, ...confirmedAddressCoordinate(valid) };
}

export const emptyAddressForm: AddressFormValues = {
  label: '', contactName: '', phone: '', streetAddress: '', ward: '', district: '', city: '', isDefault: false,
};
