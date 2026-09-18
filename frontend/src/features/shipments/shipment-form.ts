import { z } from 'zod';
import type { Address } from '../addresses/address-api';
import type { QuoteInput } from '../pricing/pricing-api';
import type { AddressSnapshot } from './shipment-types';
import { getConfirmedCoordinate, type LocationAddressContext } from '../addresses/address-location-model.ts';
import { isCanonicalAddress } from '../addresses/administrative-model.ts';

const phonePattern = /^\+?[0-9][0-9\s-]{7,18}[0-9]$/;

export const shipmentFormSchema = z
  .object({
    pickupAddressId: z.string().uuid('Chọn địa chỉ lấy hàng'),
    deliveryContactName: z.string().trim().min(2, 'Tên người nhận cần ít nhất 2 ký tự').max(100),
    deliveryPhone: z.string().trim().regex(phonePattern, 'Số điện thoại không đúng định dạng'),
    deliveryStreetAddress: z.string().trim().min(3, 'Nhập số nhà, tên đường').max(255),
    deliveryWard: z.string().trim().min(2, 'Nhập phường/xã').max(100),
    deliveryDistrict: z.string().trim().max(100),
    confirmedAddressFingerprint: z.string().optional(),
    deliveryCity: z.string().trim().min(2, 'Nhập tỉnh/thành phố').max(100),
    deliveryLatitude: z
      .number()
      .min(-90, 'Vĩ độ từ -90 đến 90')
      .max(90, 'Vĩ độ từ -90 đến 90')
      .optional(),
    deliveryLongitude: z
      .number()
      .min(-180, 'Kinh độ từ -180 đến 180')
      .max(180, 'Kinh độ từ -180 đến 180')
      .optional(),
    description: z.string().trim().min(2, 'Mô tả hàng hóa cần ít nhất 2 ký tự').max(200),
    packageType: z.string().trim().min(2).max(50),
    weightGrams: z.number().int().min(1, 'Khối lượng phải lớn hơn 0').max(100_000),
    lengthCm: z.number().min(1).max(300),
    widthCm: z.number().min(1).max(300),
    heightCm: z.number().min(1).max(300),
    codAmount: z.number().int().min(0).max(1_000_000_000),
    shippingFeePayer: z.enum(['SENDER', 'RECEIVER'], {
      error: 'Chọn người chịu phí vận chuyển',
    }),
  })
  .superRefine((values, context) => {
    if (!isCanonicalAddress(values.deliveryCity, values.deliveryWard)) {
      context.addIssue({ code: 'custom', message: 'Chọn phường/xã thuộc tỉnh/thành hiện tại', path: ['deliveryWard'] });
    }
    const hasLatitude = values.deliveryLatitude !== undefined;
    const hasLongitude = values.deliveryLongitude !== undefined;
    if (hasLatitude === hasLongitude) return;
    if (!hasLatitude) {
      context.addIssue({
        code: 'custom',
        message: 'Nhập cả vĩ độ và kinh độ',
        path: ['deliveryLatitude'],
      });
    }
    if (!hasLongitude) {
      context.addIssue({
        code: 'custom',
        message: 'Nhập cả vĩ độ và kinh độ',
        path: ['deliveryLongitude'],
      });
    }
  });

export type ShipmentFormValues = z.infer<typeof shipmentFormSchema>;

export const shipmentFormDefaults = {
  pickupAddressId: '',
  deliveryContactName: '',
  deliveryPhone: '',
  deliveryStreetAddress: '',
  deliveryWard: '',
  deliveryDistrict: '',
  deliveryCity: '',
  description: '',
  packageType: 'PARCEL',
  weightGrams: 1_000,
  lengthCm: 20,
  widthCm: 15,
  heightCm: 10,
  codAmount: 0,
  shippingFeePayer: undefined,
};

export function addressToSnapshot(address: Address): AddressSnapshot {
  return {
    contactName: address.contactName,
    phone: address.phone,
    streetAddress: address.streetAddress,
    ward: address.ward,
    district: address.district,
    city: address.city,
    ...(address.latitude !== null && address.longitude !== null
      ? { latitude: address.latitude, longitude: address.longitude }
      : {}),
  };
}

export function deliverySnapshot(values: ShipmentFormValues): AddressSnapshot {
  const coordinate = getConfirmedCoordinate(
    values.deliveryLatitude !== undefined && values.deliveryLongitude !== undefined
      ? { latitude: values.deliveryLatitude, longitude: values.deliveryLongitude } : undefined,
    values.confirmedAddressFingerprint,
    getDeliveryAddressContext(values),
  );
  return {
    contactName: values.deliveryContactName.trim(),
    phone: values.deliveryPhone.trim(),
    streetAddress: values.deliveryStreetAddress.trim(),
    ward: values.deliveryWard.trim(),
    district: values.deliveryDistrict.trim(),
    city: values.deliveryCity.trim(),
    ...coordinate,
  };
}

export function getDeliveryAddressContext(values: Partial<ShipmentFormValues>): LocationAddressContext {
  return { street: values.deliveryStreetAddress, ward: values.deliveryWard, district: values.deliveryDistrict, city: values.deliveryCity };
}

export function parseOptionalCoordinateInput(value: unknown): number | undefined {
  return value === '' || value === null || value === undefined ? undefined : Number(value);
}

export function quoteInput(values: ShipmentFormValues, pickupAddress: Address): QuoteInput {
  return {
    pickup: addressToSnapshot(pickupAddress),
    delivery: deliverySnapshot(values),
    packageType: values.packageType,
    weightGrams: values.weightGrams,
    lengthCm: values.lengthCm,
    widthCm: values.widthCm,
    heightCm: values.heightCm,
    codAmount: values.codAmount,
  };
}

export function quoteSignature(values: Partial<ShipmentFormValues>): string {
  return JSON.stringify({
    pickupAddressId: values.pickupAddressId,
    deliveryContactName: values.deliveryContactName,
    deliveryPhone: values.deliveryPhone,
    deliveryStreetAddress: values.deliveryStreetAddress,
    deliveryWard: values.deliveryWard,
    deliveryDistrict: values.deliveryDistrict,
    deliveryCity: values.deliveryCity,
    deliveryLatitude: values.deliveryLatitude,
    deliveryLongitude: values.deliveryLongitude,
    confirmedAddressFingerprint: values.confirmedAddressFingerprint,
    description: values.description,
    packageType: values.packageType,
    weightGrams: values.weightGrams,
    lengthCm: values.lengthCm,
    widthCm: values.widthCm,
    heightCm: values.heightCm,
    codAmount: values.codAmount,
  });
}
