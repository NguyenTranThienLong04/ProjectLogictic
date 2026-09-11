export const SHIPPING_FEE_PAYER_OPTIONS = [
  {
    value: 'SENDER',
    label: 'Người gửi trả phí',
    description: 'Người gửi chịu trách nhiệm thanh toán phí vận chuyển.',
  },
  {
    value: 'RECEIVER',
    label: 'Người nhận trả phí',
    description: 'Người nhận chịu trách nhiệm thanh toán phí vận chuyển.',
  },
] as const;

export type ShippingFeePayer = (typeof SHIPPING_FEE_PAYER_OPTIONS)[number]['value'];

export const shippingFeePayerLabels: Record<ShippingFeePayer, string> = {
  SENDER: 'Người gửi trả phí',
  RECEIVER: 'Người nhận trả phí',
};

export function shippingFeePayerLabel(payer: ShippingFeePayer): string {
  return shippingFeePayerLabels[payer];
}
