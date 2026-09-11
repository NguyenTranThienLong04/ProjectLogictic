import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AssignWarehouseStaffDto } from './dto/assign-warehouse-staff.dto.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import { ListWarehouseShipmentsDto } from './dto/list-warehouse-shipments.dto.js';
import { ListWarehouseExceptionsDto } from './dto/list-warehouse-exceptions.dto.js';
import { ListWarehousesDto } from './dto/list-warehouses.dto.js';
import { LookupCheckInShipmentDto } from './dto/lookup-check-in-shipment.dto.js';
import { ReceiveTransferDto } from './dto/receive-transfer.dto.js';
import { ReceiveReturnDto } from './dto/receive-return.dto.js';
import { RouteDestinationDto } from './dto/route-destination.dto.js';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto.js';
import { WarehouseCheckInDto } from './dto/warehouse-check-in.dto.js';
import { WarehousesService } from './warehouses.service.js';

@ApiTags('warehouses')
@ApiBearerAuth()
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  // ==========================================
  // WAREHOUSE CRUD
  // ==========================================

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new warehouse (Admin only)' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateWarehouseDto,
    @Req() request: Request,
  ) {
    return this.warehousesService.createWarehouse(dto, actor, this.context(request));
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({
    summary: 'List warehouses with filters',
    description:
      'Warehouse staff receive full details for their assigned warehouse and id/code/name/address only for other warehouses.',
  })
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListWarehousesDto) {
    return this.warehousesService.listWarehouses(query, actor);
  }

  @Get('staff/me')
  @Roles(UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'Get current user warehouse staff profile' })
  getMyStaffProfile(@CurrentUser() actor: AuthenticatedUser) {
    return this.warehousesService.getStaffProfileForUser(actor.id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.WAREHOUSE_STAFF)
  @ApiOperation({
    summary: 'Get warehouse detail',
    description:
      'Warehouse staff receive id/code/name/address only when viewing a warehouse outside their assignment.',
  })
  getOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehousesService.getWarehouse(id, actor);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update warehouse info (Admin only)' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
    @Req() request: Request,
  ) {
    return this.warehousesService.updateWarehouse(id, dto, actor, this.context(request));
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Toggle warehouse active status (Admin only)' })
  toggleStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.warehousesService.toggleWarehouseStatus(id, actor, this.context(request));
  }

  // ==========================================
  // WAREHOUSE STAFF
  // ==========================================

  @Post(':id/staff')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Assign a staff member to warehouse (Admin only)' })
  assignStaff(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWarehouseStaffDto,
    @Req() request: Request,
  ) {
    return this.warehousesService.assignStaff(id, dto, actor, this.context(request));
  }

  @Get(':id/staff')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'List staff assigned to warehouse' })
  listStaff(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehousesService.listStaff(id);
  }

  @Patch('staff/:profileId/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Toggle staff profile active status (Admin only)' })
  toggleStaffStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Req() request: Request,
  ) {
    return this.warehousesService.toggleStaffStatus(profileId, actor, this.context(request));
  }

  // ==========================================
  // INBOUND, CHECK-IN & ROUTING
  // ==========================================

  @Get(':id/check-in/lookup')
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Look up and authorize a picked-up shipment before package check-in' })
  lookupCheckInShipment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: LookupCheckInShipmentDto,
  ) {
    return this.warehousesService.lookupCheckInShipment(id, query.trackingCode, actor);
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Check in a picked-up shipment to warehouse with verification' })
  checkIn(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WarehouseCheckInDto,
    @Req() request: Request,
  ) {
    return this.warehousesService.checkIn(id, dto, actor, this.context(request));
  }

  @Post(':id/shipments/:shipmentId/route-destination')
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Route destination warehouse for sorted shipment' })
  routeDestination(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: RouteDestinationDto,
    @Req() request: Request,
  ) {
    return this.warehousesService.routeDestination(
      id,
      shipmentId,
      dto,
      actor,
      this.context(request),
    );
  }

  @Post(':id/shipments/:shipmentId/ready-for-delivery')
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Mark shipment ready for delivery assignment' })
  readyForDelivery(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Req() request: Request,
  ) {
    return this.warehousesService.markReadyForDelivery(
      id,
      shipmentId,
      actor,
      this.context(request),
    );
  }

  // ==========================================
  // TRANSFERS
  // ==========================================

  @Post(':id/transfers')
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a pending inter-warehouse transfer' })
  createTransfer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTransferDto,
    @Req() request: Request,
  ) {
    return this.warehousesService.createTransfer(id, dto, actor, this.context(request));
  }

  @Post(':id/transfers/:transferId/dispatch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Dispatch a pending inter-warehouse transfer' })
  dispatchTransfer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Req() request: Request,
  ) {
    return this.warehousesService.dispatchTransfer(id, transferId, actor, this.context(request));
  }

  @Post(':id/transfers/:transferId/receive')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Receive an inbound transfer at destination warehouse' })
  receiveTransfer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Body() dto: ReceiveTransferDto,
    @Req() request: Request,
  ) {
    return this.warehousesService.receiveTransfer(
      id,
      transferId,
      dto,
      actor,
      this.context(request),
    );
  }

  @Post(':id/shipments/:shipmentId/receive-return')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WAREHOUSE_STAFF)
  @ApiOperation({ summary: 'Receive an in-transit return at its designated warehouse' })
  receiveReturn(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: ReceiveReturnDto,
    @Req() request: Request,
  ) {
    return this.warehousesService.receiveReturn(id, shipmentId, dto, actor, this.context(request));
  }

  @Get(':id/transfers')
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'List transfers of a warehouse' })
  listTransfers(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('direction') direction?: 'inbound' | 'outbound' | 'all',
  ) {
    return this.warehousesService.listTransfers(id, direction, actor);
  }

  // ==========================================
  // INVENTORY & QUEUES
  // ==========================================

  @Get(':id/shipments')
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'List shipments currently at warehouse' })
  listShipments(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListWarehouseShipmentsDto,
  ) {
    return this.warehousesService.listWarehouseShipments(id, query, actor);
  }

  @Get(':id/inbound-queue')
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'List inbound queue (incoming transfers & picked-up shipments)' })
  listInboundQueue(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.warehousesService.listInboundQueue(id, actor);
  }

  @Get(':id/exceptions')
  @Roles(UserRole.WAREHOUSE_STAFF, UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'List canonical damaged/lost exceptions in warehouse scope' })
  @ApiOkResponse({ description: 'Paginated warehouse-scoped exception shipments' })
  listExceptions(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) warehouseId: string,
    @Query() query: ListWarehouseExceptionsDto,
  ) {
    return this.warehousesService.listExceptions(warehouseId, query, actor);
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
