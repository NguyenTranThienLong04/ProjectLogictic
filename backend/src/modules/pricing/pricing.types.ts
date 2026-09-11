import type { PricingConfig } from '../../generated/prisma/client.js';

export interface PricingBreakdown {
  configVersion: number;
  baseFee: number;
  distanceFee: number;
  weightFee: number;
  codFee: number;
  surcharge: number;
  discount: number;
  totalFee: number;
}

export type PublicPricingConfig = Pick<
  PricingConfig,
  | 'id'
  | 'version'
  | 'baseFee'
  | 'includedWeightGrams'
  | 'extraWeightFeePerKg'
  | 'codFeeBasisPoints'
  | 'distanceFee'
  | 'surcharge'
  | 'discount'
  | 'isActive'
  | 'createdAt'
>;
