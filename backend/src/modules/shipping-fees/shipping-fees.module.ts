import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShippingFeePaymentsController } from './shipping-fee-payments.controller.js';
import { DisabledPaymentProvider } from './payments/disabled-payment.provider.js';
import { PaymentGatewayService } from './payments/payment-gateway.service.js';
import { SHIPPING_FEE_PAYMENT_PROVIDER } from './payments/payment-provider.js';
import { ShippingFeePaymentsService } from './payments/shipping-fee-payments.service.js';
import { TestPaymentProvider } from './payments/test-payment.provider.js';
import { ShippingFeesController } from './shipping-fees.controller.js';
import { ShippingFeesService } from './shipping-fees.service.js';

@Module({
  controllers: [ShippingFeesController, ShippingFeePaymentsController],
  providers: [
    ShippingFeesService,
    ShippingFeePaymentsService,
    PaymentGatewayService,
    {
      provide: SHIPPING_FEE_PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('PAYMENT_PROVIDER') === 'TEST'
          ? new TestPaymentProvider(config)
          : new DisabledPaymentProvider(),
    },
  ],
  exports: [ShippingFeesService, ShippingFeePaymentsService],
})
export class ShippingFeesModule {}
