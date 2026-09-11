import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codStatusBadgeConfig,
  shippingFeeStatusBadgeConfig,
} from '../src/components/ui/status-badge-config.ts';
import { parseShippingFeeAmount } from '../src/features/operations/shipping-fee-collection.ts';

test('shipping fee collection accepts only safe non-negative integer input text', () => {
  assert.equal(parseShippingFeeAmount('35000'), 35_000);
  assert.equal(parseShippingFeeAmount('0'), 0);
  assert.equal(parseShippingFeeAmount(''), undefined);
  assert.equal(parseShippingFeeAmount('35.000'), undefined);
  assert.equal(parseShippingFeeAmount('35000.5'), undefined);
  assert.equal(parseShippingFeeAmount('-1'), undefined);
  assert.equal(parseShippingFeeAmount('9007199254740992'), undefined);
});

test('shipping fee statuses have distinct text labels from COD statuses', () => {
  assert.equal(shippingFeeStatusBadgeConfig.PENDING.label, 'Chờ thu phí vận chuyển');
  assert.equal(
    shippingFeeStatusBadgeConfig.PAYMENT_PENDING.label,
    'Đang chờ xác nhận thanh toán',
  );
  assert.equal(shippingFeeStatusBadgeConfig.PAID.label, 'Đã thanh toán trực tuyến');
  assert.equal(shippingFeeStatusBadgeConfig.COLLECTED.label, 'Đã thu phí vận chuyển');
  assert.equal(shippingFeeStatusBadgeConfig.REMITTED.label, 'Tài xế đã bàn giao phí');
  assert.equal(shippingFeeStatusBadgeConfig.SETTLED.label, 'Đã đối soát phí vận chuyển');
  assert.equal(shippingFeeStatusBadgeConfig.DISPUTED.label, 'Phí vận chuyển đang tranh chấp');
  assert.equal(shippingFeeStatusBadgeConfig.CANCELLED.label, 'Đã hủy thu phí');
  assert.notEqual(
    shippingFeeStatusBadgeConfig.REMITTED.surface,
    codStatusBadgeConfig.REMITTED.surface,
  );
});
