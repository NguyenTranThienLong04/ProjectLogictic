import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AssignmentsModule } from '../assignments/assignments.module.js';
import { WarehousesController } from './warehouses.controller.js';
import { WarehousesService } from './warehouses.service.js';
import { WarehouseTransferLifecycleService } from './warehouse-transfer-lifecycle.service.js';

@Module({
  imports: [DatabaseModule, NotificationsModule, AssignmentsModule],
  controllers: [WarehousesController],
  providers: [WarehousesService, WarehouseTransferLifecycleService],
  exports: [WarehousesService, WarehouseTransferLifecycleService],
})
export class WarehousesModule {}
