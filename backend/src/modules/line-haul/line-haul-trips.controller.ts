import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AssignLineHaulTransferDto } from './dto/assign-line-haul-transfer.dto.js';
import { CancelLineHaulTripDto } from './dto/cancel-line-haul-trip.dto.js';
import { CreateLineHaulTripDto } from './dto/create-line-haul-trip.dto.js';
import { ListEligibleLineHaulResourcesDto } from './dto/list-eligible-line-haul-resources.dto.js';
import { LineHaulResourceAvailabilityDto } from './dto/line-haul-resource-availability.dto.js';
import { ListLineHaulTripsDto } from './dto/list-line-haul-trips.dto.js';
import { ScheduleLineHaulTripDto } from './dto/schedule-line-haul-trip.dto.js';
import { UnscheduleLineHaulTripDto } from './dto/unschedule-line-haul-trip.dto.js';
import { LineHaulTripsService } from './line-haul-trips.service.js';

@ApiTags('line-haul trips')
@ApiBearerAuth()
@Controller('line-haul/trips')
export class LineHaulTripsController {
  constructor(private readonly trips: LineHaulTripsService) {}

  @Get('eligible-drivers')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'List active LINE_HAUL drivers without active trip ownership' })
  listEligibleDrivers(@Query() query: ListEligibleLineHaulResourcesDto) {
    return this.trips.listEligibleDrivers(query);
  }

  @Get('eligible-vehicles')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'List available fleet vehicles without active trip ownership' })
  listEligibleVehicles(@Query() query: ListEligibleLineHaulResourcesDto) {
    return this.trips.listEligibleVehicles(query);
  }

  @Get('resource-availability')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Show driver and vehicle availability for a half-open schedule window' })
  resourceAvailability(@Query() query: LineHaulResourceAvailabilityDto) {
    return this.trips.resourceAvailability(query);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Plan a warehouse-to-warehouse line-haul trip' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateLineHaulTripDto,
    @Req() request: Request,
  ) {
    return this.trips.create(actor, dto, this.context(request));
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'List line-haul trips' })
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListLineHaulTripsDto) {
    return this.trips.list(actor, query);
  }

  @Get(':id/eligible-transfers')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'List pending WarehouseTransfers matching a planned trip route' })
  listEligibleTransfers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListEligibleLineHaulResourcesDto,
  ) {
    return this.trips.listEligibleTransfers(id, query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'Get line-haul trip detail and transfer-assignment history' })
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.get(actor, id);
  }

  @Post(':id/schedule')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Reserve the assigned driver and vehicle for a planned trip window' })
  schedule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleLineHaulTripDto,
    @Req() request: Request,
  ) {
    return this.trips.schedule(actor, id, dto, this.context(request));
  }

  @Post(':id/reschedule')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Move a planned trip reservation to a different window' })
  reschedule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleLineHaulTripDto,
    @Req() request: Request,
  ) {
    return this.trips.reschedule(actor, id, dto, this.context(request));
  }

  @Post(':id/unschedule')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({
    summary: 'Release a planned trip schedule reservation without deleting the trip',
  })
  unschedule(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UnscheduleLineHaulTripDto,
    @Req() request: Request,
  ) {
    return this.trips.unschedule(actor, id, dto, this.context(request));
  }

  @Post(':id/prepare')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Validate and lock a planned manifest as ready' })
  prepare(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.trips.prepare(actor, id, this.context(request));
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Atomically dispatch a ready trip and its complete manifest' })
  dispatch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.trips.dispatch(actor, id, this.context(request));
  }

  @Post(':id/arrive')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'Confirm vehicle arrival at the exact destination warehouse' })
  arrive(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.trips.arrive(actor, id, this.context(request));
  }

  @Post(':id/recalculate-route')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({
    summary: 'Create a new current-GPS to existing-destination route version',
  })
  recalculateRoute(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.trips.recalculateRoute(actor, id, this.context(request));
  }

  @Post(':id/transfers')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Associate a pending WarehouseTransfer with a planned trip' })
  assignTransfer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignLineHaulTransferDto,
    @Req() request: Request,
  ) {
    return this.trips.assignTransfer(actor, id, dto, this.context(request));
  }

  @Post(':id/transfers/:transferId/remove')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Remove a planned transfer assignment while preserving its history' })
  removeTransfer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Req() request: Request,
  ) {
    return this.trips.removeTransfer(actor, id, transferId, this.context(request));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Cancel a planned or ready line-haul trip' })
  cancel(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelLineHaulTripDto,
    @Req() request: Request,
  ) {
    return this.trips.cancel(actor, id, dto, this.context(request));
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
