import axios from 'axios';
import { api } from '../../services/api';
import type { ApiEnvelope } from '../../types/auth';
import type { ApiErrorBody } from '../../types/auth';
import type {
  AddressSnapshot,
  PackageSnapshot,
  PricingBreakdown,
} from '../shipments/shipment-types';

export interface QuoteInput extends Omit<PackageSnapshot, 'description'> {
  pickup: AddressSnapshot;
  delivery: AddressSnapshot;
  codAmount: number;
}

export interface PricingConfig {
  id: string;
  version: number;
  baseFee: number;
  includedWeightGrams: number;
  extraWeightFeePerKg: number;
  codFeeBasisPoints: number;
  distanceFee: number;
  surcharge: number;
  discount: number;
  isActive: boolean;
  createdAt: string;
}

export interface PricingConfigInput {
  baseFee: number;
  includedWeightGrams: number;
  extraWeightFeePerKg: number;
  codFeeBasisPoints: number;
}

export function isPricingConfigUnavailable(error: unknown): boolean {
  return (
    axios.isAxiosError<ApiErrorBody>(error) &&
    error.response?.status === 503 &&
    error.response.data?.code === 'PRICING_CONFIG_UNAVAILABLE'
  );
}

export async function getQuote(input: QuoteInput): Promise<PricingBreakdown> {
  const response = await api.post<ApiEnvelope<PricingBreakdown>>('/pricing/quote', input);
  return response.data.data;
}

export async function getPricingConfig(): Promise<PricingConfig> {
  const response = await api.get<ApiEnvelope<PricingConfig>>('/pricing/config');
  return response.data.data;
}

export async function createPricingConfig(input: PricingConfigInput): Promise<PricingConfig> {
  const response = await api.post<ApiEnvelope<PricingConfig>>('/pricing/config', input);
  return response.data.data;
}
