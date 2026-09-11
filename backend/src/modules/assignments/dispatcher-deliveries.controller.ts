import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { DeliveryService } from './delivery.service.js';
import { AssignDeliveryDriverDto } from './dto/assign-delivery-driver.dto.js';
import { ReturnNoteDto } from './dto/return-note.dto.js';

@ApiTags('dispatcher-deliveries')
@ApiBearerAuth()
@Roles(UserRole.DISPATCHER, UserRole.ADMIN)
@Controller('dispatcher/shipments')
export class DispatcherDeliveriesController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get(':id/delivery-candidates')
  @ApiOperation({
    summary: 'List eligible delivery candidates ranked by road route with Haversine fallback',
  })
  listCandidates(@Param('id', ParseUUIDPipe) shipmentId: string) {
    return this.delivery.listCandidates(shipmentId);
  }

  @Post(':id/delivery-assignments')
  @ApiOperation({ summary: 'Assign an available delivery driver idempotently' })
  assign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: AssignDeliveryDriverDto,
    @Req() request: Request,
  ) {
    return this.delivery.assign(actor, shipmentId, dto, this.context(request));
  }

  @Post(':id/redeliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Schedule a failed shipment for a new delivery assignment' })
  redeliver(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Req() request: Request,
  ) {
    return this.delivery.redeliver(actor, shipmentId, this.context(request));
  }

  @Post(':id/return/request')
  @HttpCode(HttpStatus.OK)
  requestReturn(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: ReturnNoteDto,
    @Req() request: Request,
  ) {
    return this.delivery.requestReturn(actor, shipmentId, dto, this.context(request));
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
