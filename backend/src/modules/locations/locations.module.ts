import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';
import { RoutingModule } from '../routing/routing.module.js';

@Module({
  imports: [NotificationsModule, RoutingModule],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
