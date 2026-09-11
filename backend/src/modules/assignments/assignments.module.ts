import { Module } from '@nestjs/common';
import { LocationsModule } from '../locations/locations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { ShippingFeesModule } from '../shipping-fees/shipping-fees.module.js';
import { AssignmentCandidatesService } from './assignment-candidates.service.js';
import { AssignmentPolicy } from './assignment.policy.js';
import { AssignmentsService } from './assignments.service.js';
import { DispatcherPickupsController } from './dispatcher-pickups.controller.js';
import { DispatcherDeliveriesController } from './dispatcher-deliveries.controller.js';
import { DriverDeliveriesController } from './driver-deliveries.controller.js';
import { DeliveryService } from './delivery.service.js';
import { DriverAssignmentsController } from './driver-assignments.controller.js';
import { ShipmentTransitionPolicy } from './shipment-transition.policy.js';
import { DriverTaskOwnershipService } from './driver-task-ownership.service.js';

@Module({
  imports: [NotificationsModule, LocationsModule, RoutingModule, ShippingFeesModule],
  controllers: [
    DispatcherPickupsController,
    DispatcherDeliveriesController,
    DriverAssignmentsController,
    DriverDeliveriesController,
  ],
  providers: [
    AssignmentsService,
    DeliveryService,
    AssignmentCandidatesService,
    AssignmentPolicy,
    ShipmentTransitionPolicy,
    DriverTaskOwnershipService,
  ],
  exports: [ShipmentTransitionPolicy, AssignmentsService, DriverTaskOwnershipService],
})
export class AssignmentsModule {}
