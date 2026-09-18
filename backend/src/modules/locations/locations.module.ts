import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';
import { RoutingModule } from '../routing/routing.module.js';
import { AddressSearchService } from './address-search.service.js';

@Module({
  imports: [NotificationsModule, RoutingModule],
  controllers: [LocationsController],
  providers: [LocationsService, AddressSearchService],
  exports: [LocationsService],
})
export class LocationsModule {}
