import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ShippingFeesModule } from '../shipping-fees/shipping-fees.module.js';
import { CancellationPolicy } from './cancellation.policy.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';
import { TrackingController } from './tracking.controller.js';

@Module({
  imports: [PricingModule, NotificationsModule, ShippingFeesModule],
  controllers: [ShipmentsController, TrackingController],
  providers: [ShipmentsService, CancellationPolicy],
})
export class ShipmentsModule {}
