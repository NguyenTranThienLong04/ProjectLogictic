import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UpdateDriverLocationDto } from './dto/update-driver-location.dto.js';
import type {
  DriverLocationResponse,
  LineHaulLocationResponse,
  LineHaulTripLocationResponse,
  OperationalDriverLocationResponse,
} from './locations.service.js';
import { LocationsService } from './locations.service.js';
import { AddressSearchService } from './address-search.service.js';
import { AddressSearchDto } from './dto/address-search.dto.js';

@ApiTags('locations')
@ApiBearerAuth()
@Controller()
export class LocationsController {
  constructor(
    private readonly locations: LocationsService,
    private readonly addressSearch: AddressSearchService,
  ) {}

  @Post('locations/address-search')
  @Roles(UserRole.CUSTOMER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search Vietnamese addresses for explicit map selection' })
  searchAddress(@Body() dto: AddressSearchDto) {
    return this.addressSearch.search(dto);
  }

  @Post('driver/location')
  @Roles(UserRole.DRIVER)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Store the authenticated driver current location for 20 seconds' })
  updateMine(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateDriverLocationDto,
  ): Promise<DriverLocationResponse> {
    return this.locations.updateMine(actor, dto);
  }

  @Get('driver/location')
  @Roles(UserRole.DRIVER)
  @ApiOperation({ summary: 'Read the authenticated driver current Redis location' })
  @ApiOkResponse({
    description: 'Current location, or null when it is missing, stale, or temporarily unavailable',
  })
  getMine(@CurrentUser() actor: AuthenticatedUser): Promise<DriverLocationResponse | null> {
    return this.locations.getMine(actor.id);
  }

  @Get('shipments/:id/location')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Get the owned shipment driver location while out for delivery' })
  getCustomerShipmentLocation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) shipmentId: string,
  ): Promise<DriverLocationResponse | null> {
    return this.locations.getCustomerShipmentLocation(actor.id, shipmentId);
  }

  @Get('dispatcher/driver-locations')
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Current locations of online operational drivers' })
  @ApiOperation({ summary: 'List current driver locations for the operations map' })
  listOperationalLocations(): Promise<OperationalDriverLocationResponse[]> {
    return this.locations.listOperationalLocations();
  }

  @Post('driver/line-haul/trips/:id/location')
  @Roles(UserRole.DRIVER)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Store GPS for the authenticated driver owned in-transit trip' })
  updateMyLineHaulTrip(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Body() dto: UpdateDriverLocationDto,
  ): Promise<LineHaulLocationResponse> {
    return this.locations.updateMyLineHaulTrip(actor, tripId, dto);
  }

  @Get('driver/line-haul/active-trip')
  @Roles(UserRole.DRIVER)
  @ApiOperation({ summary: 'Get the authenticated driver active line-haul GPS context' })
  getMyActiveLineHaulTrip(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<LineHaulTripLocationResponse | null> {
    return this.locations.getMyActiveLineHaulTrip(actor.id);
  }

  @Get('line-haul/locations')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.WAREHOUSE_STAFF)
  @ApiOkResponse({
    description: 'In-transit trips with current, missing, stale, or unavailable GPS state',
  })
  @ApiOperation({ summary: 'List warehouse-scoped active line-haul locations' })
  listActiveLineHaulLocations(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<LineHaulTripLocationResponse[]> {
    return this.locations.listActiveLineHaulLocations(actor);
  }

  @Get('line-haul/trips/:id/location')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.WAREHOUSE_STAFF, UserRole.DRIVER)
  @ApiOkResponse({ description: 'Authorized trip GPS state; never inferred from PostgreSQL' })
  @ApiOperation({ summary: 'Get one scoped line-haul trip location state' })
  getLineHaulTripLocation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) tripId: string,
  ): Promise<LineHaulTripLocationResponse> {
    return this.locations.getLineHaulTripLocation(actor, tripId);
  }
}
