import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ControlTowerQueryDto } from './control-tower-query.dto.js';
import { ControlTowerService } from './control-tower.service.js';

@ApiTags('control tower')
@ApiBearerAuth()
@Controller('control-tower')
@Roles(UserRole.ADMIN, UserRole.DISPATCHER)
export class ControlTowerController {
  constructor(private readonly tower: ControlTowerService) {}

  @Get('filters')
  @ApiOperation({
    summary:
      'Control Tower filter values and effective SLA policy; warehouse catalogue uses GET /warehouses',
  })
  filters() {
    return this.tower.filters();
  }

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Active shipment/trip summary and priority page in one snapshot. Dates filter createdAt [from,to). Warehouse matches current/origin/destination/return.',
  })
  dashboard(@Query() query: ControlTowerQueryDto) {
    return this.tower.dashboard(query);
  }
}
