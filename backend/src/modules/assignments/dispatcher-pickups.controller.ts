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
import type { AssignmentResponse } from './assignment.response.js';
import { AssignmentsService } from './assignments.service.js';
import { AssignPickupDriverDto } from './dto/assign-pickup-driver.dto.js';
import { ListOperationalShipmentsDto } from './dto/list-operational-shipments.dto.js';
import { ReassignPickupDriverDto } from './dto/reassign-pickup-driver.dto.js';

@ApiTags('dispatcher-pickups')
@ApiBearerAuth()
@Roles(UserRole.DISPATCHER, UserRole.ADMIN)
@Controller('dispatcher/shipments')
export class DispatcherPickupsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List shipments in the pickup operations workflow' })
  list(@Query() query: ListOperationalShipmentsDto) {
    return this.assignments.listOperationalShipments(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an operational shipment detail for Dispatcher or Admin' })
  get(@Param('id', ParseUUIDPipe) shipmentId: string) {
    return this.assignments.getOperationalShipment(shipmentId);
  }

  @Get(':id/pickup-candidates')
  @ApiOperation({
    summary: 'List eligible pickup candidates ranked by road route with Haversine fallback',
  })
  listCandidates(@Param('id', ParseUUIDPipe) shipmentId: string) {
    return this.assignments.listPickupCandidates(shipmentId);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a pending shipment and queue it for pickup assignment' })
  confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Req() request: Request,
  ) {
    return this.assignments.confirmShipment(actor, shipmentId, this.context(request));
  }

  @Post(':id/pickup-assignments')
  @ApiOperation({ summary: 'Assign an available pickup driver idempotently' })
  assign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: AssignPickupDriverDto,
    @Req() request: Request,
  ): Promise<AssignmentResponse> {
    return this.assignments.assignPickup(actor, shipmentId, dto, this.context(request));
  }

  @Post(':id/pickup-reassignments')
  @ApiOperation({ summary: 'Cancel the active assignment and create a replacement' })
  reassign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: ReassignPickupDriverDto,
    @Req() request: Request,
  ): Promise<AssignmentResponse> {
    return this.assignments.reassignPickup(actor, shipmentId, dto, this.context(request));
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
