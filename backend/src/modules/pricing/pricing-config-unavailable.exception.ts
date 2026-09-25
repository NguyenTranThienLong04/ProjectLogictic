import { ServiceUnavailableException } from '@nestjs/common';

// Only this known business condition may cross the generic 5xx redaction boundary.
export class PricingConfigUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'PRICING_CONFIG_UNAVAILABLE',
      message: 'Chưa có cấu hình giá vận chuyển đang hoạt động. Vui lòng liên hệ quản trị viên.',
    });
  }
}
