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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { DeliveryService } from './delivery.service.js';
import { CompleteDeliveryDto } from './dto/complete-delivery.dto.js';
import { FailDeliveryDto } from './dto/fail-delivery.dto.js';
import { ListDriverDeliveriesDto } from './dto/list-driver-deliveries.dto.js';

@ApiTags('driver-deliveries')
@ApiBearerAuth()
@Roles(UserRole.DRIVER)
@Controller('driver/delivery-assignments')
export class DriverDeliveriesController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get()
  @ApiOperation({ summary: 'List delivery assignments owned by the authenticated driver' })
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListDriverDeliveriesDto) {
    return this.delivery.listMine(actor.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an owned delivery assignment detail' })
  @ApiOkResponse({
    description:
      'Owned delivery detail with destination Warehouse before start or receiver task location after start',
  })
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) assignmentId: string) {
    return this.delivery.getMine(actor.id, assignmentId);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start an owned delivery assignment and create its attempt' })
  start(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) assignmentId: string,
    @Req() request: Request,
  ) {
    return this.delivery.start(actor, assignmentId, this.context(request));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete delivery idempotently with a Delivery ShipmentProof' })
  complete(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) assignmentId: string,
    @Body() dto: CompleteDeliveryDto,
    @Req() request: Request,
  ) {
    return this.delivery.complete(actor, assignmentId, dto, this.context(request));
  }

  @Post(':id/fail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the failure of an owned active delivery attempt' })
  fail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) assignmentId: string,
    @Body() dto: FailDeliveryDto,
    @Req() request: Request,
  ) {
    return this.delivery.fail(actor, assignmentId, dto, this.context(request));
  }

  @Post(':shipmentId/start-return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Start return for the authenticated driver's latest failed delivery attempt",
  })
  startReturn(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Req() request: Request,
  ) {
    return this.delivery.startReturn(actor, shipmentId, this.context(request));
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
