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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CancelShipmentDto } from './dto/cancel-shipment.dto.js';
import { CreateShipmentDto } from './dto/create-shipment.dto.js';
import { ListShipmentsDto } from './dto/list-shipments.dto.js';
import type { PaginatedShipmentsResponse, ShipmentResponse } from './shipment.response.js';
import { ShipmentsService } from './shipments.service.js';

@ApiTags('shipments')
@ApiBearerAuth()
@Roles(UserRole.CUSTOMER)
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an idempotent shipment with server-calculated pricing' })
  @ApiCreatedResponse({ description: 'Created shipment with immutable snapshots' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateShipmentDto,
    @Req() request: Request,
  ): Promise<ShipmentResponse> {
    return this.shipmentsService.create(user, dto, this.clientContext(request));
  }

  @Get()
  @ApiOperation({ summary: 'List shipments owned by the authenticated customer' })
  @ApiOkResponse({ description: 'Paginated customer shipment list' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListShipmentsDto,
  ): Promise<PaginatedShipmentsResponse> {
    return this.shipmentsService.list(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an owned shipment and its public timeline' })
  @ApiOkResponse({ description: 'Owned shipment detail' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) shipmentId: string,
  ): Promise<ShipmentResponse> {
    return this.shipmentsService.getOwned(user.id, shipmentId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an eligible owned shipment through a business command' })
  @ApiOkResponse({ description: 'Cancelled shipment with appended tracking event' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: CancelShipmentDto,
    @Req() request: Request,
  ): Promise<ShipmentResponse> {
    return this.shipmentsService.cancel(user, shipmentId, dto, this.clientContext(request));
  }

  private clientContext(request: Request): ClientContext {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
