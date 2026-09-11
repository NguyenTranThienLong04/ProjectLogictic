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
import type { AssignmentResponse } from './assignment.response.js';
import { AssignmentsService } from './assignments.service.js';
import { ListDriverAssignmentsDto } from './dto/list-driver-assignments.dto.js';
import { PickupShipmentDto } from './dto/pickup-shipment.dto.js';
import { RejectAssignmentDto } from './dto/reject-assignment.dto.js';

@ApiTags('driver-assignments')
@ApiBearerAuth()
@Roles(UserRole.DRIVER)
@Controller('driver/assignments')
export class DriverAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List pickup assignments owned by the authenticated driver' })
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListDriverAssignmentsDto) {
    return this.assignments.listMine(actor.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an owned pickup assignment detail' })
  @ApiOkResponse({
    description: 'Owned pickup assignment with proof and authorized pickup task location',
  })
  get(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) assignmentId: string,
  ): Promise<AssignmentResponse> {
    return this.assignments.getMine(actor.id, assignmentId);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an owned pending pickup assignment' })
  accept(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) assignmentId: string,
    @Req() request: Request,
  ): Promise<AssignmentResponse> {
    return this.assignments.accept(actor, assignmentId, this.context(request));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an owned pickup assignment with a required reason' })
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) assignmentId: string,
    @Body() dto: RejectAssignmentDto,
    @Req() request: Request,
  ): Promise<AssignmentResponse> {
    return this.assignments.reject(actor, assignmentId, dto, this.context(request));
  }

  @Post(':id/pickup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete pickup with an idempotent shared ShipmentProof' })
  @ApiOkResponse({ description: 'Pickup completed or existing proof returned on retry' })
  pickup(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) assignmentId: string,
    @Body() dto: PickupShipmentDto,
    @Req() request: Request,
  ): Promise<AssignmentResponse> {
    return this.assignments.pickup(actor, assignmentId, dto, this.context(request));
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
