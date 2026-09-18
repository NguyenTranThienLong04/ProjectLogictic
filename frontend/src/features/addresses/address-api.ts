import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';

export interface Address {
  id: string;
  label: string;
  contactName: string;
  phone: string;
  streetAddress: string;
  ward: string;
  district: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressInput {
  label: string;
  contactName: string;
  phone: string;
  streetAddress: string;
  ward: string;
  district: string;
  city: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
}

export async function listAddresses(): Promise<Address[]> {
  const response = await api.get<ApiEnvelope<Address[]>>('/addresses');
  return response.data.data;
}

export async function createAddress(input: AddressInput): Promise<Address> {
  const response = await api.post<ApiEnvelope<Address>>('/addresses', input);
  return response.data.data;
}

export async function updateAddress(
  addressId: string,
  input: Partial<AddressInput>,
): Promise<Address> {
  const response = await api.patch<ApiEnvelope<Address>>(`/addresses/${addressId}`, input);
  return response.data.data;
}

export async function deleteAddress(addressId: string): Promise<void> {
  await api.delete(`/addresses/${addressId}`);
}
