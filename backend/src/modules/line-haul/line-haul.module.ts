import { Module } from '@nestjs/common';
import { LineHaulPolicy } from './line-haul.policy.js';
import { LineHaulTripsController } from './line-haul-trips.controller.js';
import { LineHaulTripsService } from './line-haul-trips.service.js';
import { LineHaulVehiclesController } from './line-haul-vehicles.controller.js';
import { LineHaulVehiclesService } from './line-haul-vehicles.service.js';
import { AssignmentsModule } from '../assignments/assignments.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { WarehousesModule } from '../warehouses/warehouses.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { LineHaulPlanningController } from './line-haul-planning.controller.js';
import { LineHaulPlanningService } from './line-haul-planning.service.js';

@Module({
  imports: [
    AssignmentsModule,
    LocationsModule,
    NotificationsModule,
    WarehousesModule,
    RoutingModule,
  ],
  controllers: [LineHaulVehiclesController, LineHaulTripsController, LineHaulPlanningController],
  providers: [
    LineHaulPolicy,
    LineHaulTripsService,
    LineHaulVehiclesService,
    LineHaulPlanningService,
  ],
  exports: [LineHaulPolicy, LineHaulTripsService, LineHaulVehiclesService],
})
export class LineHaulModule {}
