import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quoteSignature,
  shipmentFormDefaults,
  shipmentFormSchema,
} from '../src/features/shipments/shipment-form.ts';
import {
  SHIPPING_FEE_PAYER_OPTIONS,
  shippingFeePayerLabel,
} from '../src/features/shipments/shipping-fee-payer.ts';

const validForm = {
  ...shipmentFormDefaults,
  pickupAddressId: '210e5c56-6639-46a3-98dd-dd6e3da0498d',
  deliveryContactName: 'Người nhận',
  deliveryPhone: '0987654321',
  deliveryStreetAddress: '2 Tràng Tiền',
  deliveryWard: 'Hoàn Kiếm',
  deliveryDistrict: 'Hoàn Kiếm',
  deliveryCity: 'Hà Nội',
  description: 'Kiện hàng',
};

test('shipment form requires one of the two explicit shipping fee payers', () => {
  assert.equal(
    shipmentFormSchema.safeParse({ ...validForm, shippingFeePayer: 'SENDER' }).success,
    true,
  );
  assert.equal(
    shipmentFormSchema.safeParse({ ...validForm, shippingFeePayer: 'RECEIVER' }).success,
    true,
  );
  assert.equal(shipmentFormSchema.safeParse(validForm).success, false);
  assert.equal(
    shipmentFormSchema.safeParse({ ...validForm, shippingFeePayer: 'THIRD_PARTY' }).success,
    false,
  );
});

test('payer changes neither quote inputs nor the quote freshness signature', () => {
  const sender = { ...validForm, shippingFeePayer: 'SENDER' };
  const receiver = { ...validForm, shippingFeePayer: 'RECEIVER' };

  assert.equal(quoteSignature(sender), quoteSignature(receiver));
});

test('UI exposes Vietnamese payer labels instead of raw enum values', () => {
  assert.deepEqual(
    SHIPPING_FEE_PAYER_OPTIONS.map(({ label, value }) => [value, label]),
    [
      ['SENDER', 'Người gửi trả phí'],
      ['RECEIVER', 'Người nhận trả phí'],
    ],
  );
  assert.equal(shippingFeePayerLabel('SENDER'), 'Người gửi trả phí');
  assert.equal(shippingFeePayerLabel('RECEIVER'), 'Người nhận trả phí');
});
