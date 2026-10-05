import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller.js';
import { DashboardsService } from './dashboards.service.js';
import { ControlTowerController } from './control-tower.controller.js';
import { ControlTowerService } from './control-tower.service.js';

@Module({
  controllers: [DashboardsController, ControlTowerController],
  providers: [DashboardsService, ControlTowerService],
})
export class DashboardsModule {}
