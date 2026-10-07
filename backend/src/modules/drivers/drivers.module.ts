import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller.js';
import { DriversService } from './drivers.service.js';
import { AssignmentsModule } from '../assignments/assignments.module.js';

@Module({
  imports: [AssignmentsModule],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
