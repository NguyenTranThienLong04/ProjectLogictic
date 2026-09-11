import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type {
  CustomerDashboardResponse,
  DispatcherDashboardResponse,
  DriverDashboardResponse,
} from './dashboard.response.js';
import { DashboardsService } from './dashboards.service.js';

@ApiTags('dashboards')
@ApiBearerAuth()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('customer')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Get the authenticated customer dashboard aggregates' })
  @ApiOkResponse({ description: 'Customer-scoped PostgreSQL aggregates and recent shipments' })
  customer(@CurrentUser() actor: AuthenticatedUser): Promise<CustomerDashboardResponse> {
    return this.dashboards.customer(actor.id);
  }

  @Get('driver')
  @Roles(UserRole.DRIVER)
  @ApiOperation({ summary: 'Get the authenticated driver dashboard aggregates' })
  @ApiOkResponse({ description: 'Driver-scoped PostgreSQL aggregates and recent tasks' })
  driver(@CurrentUser() actor: AuthenticatedUser): Promise<DriverDashboardResponse> {
    return this.dashboards.driver(actor.id);
  }

  @Get('dispatcher')
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get operations-wide dispatcher dashboard aggregates' })
  @ApiOkResponse({ description: 'Operations PostgreSQL aggregates and recent shipments' })
  dispatcher(): Promise<DispatcherDashboardResponse> {
    return this.dashboards.dispatcher();
  }
}
