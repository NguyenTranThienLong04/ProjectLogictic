import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { DriverResponse, PaginatedDriversResponse } from './driver.response.js';
import { DriversService } from './drivers.service.js';
import { CreateDriverProfileDto } from './dto/create-driver-profile.dto.js';
import { ListDriversDto } from './dto/list-drivers.dto.js';
import { SetDriverAvailabilityDto } from './dto/set-driver-availability.dto.js';
import { SetDriverCapabilitiesDto } from './dto/set-driver-capabilities.dto.js';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto.js';

@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a driver profile for an existing DRIVER account' })
  @ApiCreatedResponse({ description: 'Driver profile created' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateDriverProfileDto,
    @Req() request: Request,
  ): Promise<DriverResponse> {
    return this.driversService.create(actor, dto, this.context(request));
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'List driver profiles and operational availability' })
  list(@Query() query: ListDriversDto): Promise<PaginatedDriversResponse> {
    return this.driversService.list(query);
  }

  @Get('available')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'List operationally available drivers without shipment eligibility' })
  listAvailable(): Promise<DriverResponse[]> {
    return this.driversService.listAvailable();
  }

  @Get('me')
  @Roles(UserRole.DRIVER)
  @ApiOperation({ summary: 'Get the authenticated driver profile and availability' })
  getMine(@CurrentUser() actor: AuthenticatedUser): Promise<DriverResponse> {
    return this.driversService.getMine(actor.id);
  }

  @Patch('me/availability')
  @Roles(UserRole.DRIVER)
  @ApiOperation({ summary: 'Set the authenticated driver online or offline' })
  setAvailability(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: SetDriverAvailabilityDto,
    @Req() request: Request,
  ): Promise<DriverResponse> {
    return this.driversService.setAvailability(actor, dto.isOnline, this.context(request));
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update vehicle details or suspend/restore a driver profile' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) profileId: string,
    @Body() dto: UpdateDriverProfileDto,
    @Req() request: Request,
  ): Promise<DriverResponse> {
    return this.driversService.update(actor, profileId, dto, this.context(request));
  }

  @Patch(':id/capabilities')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Set one or more operational capabilities for a driver profile' })
  setCapabilities(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) profileId: string,
    @Body() dto: SetDriverCapabilitiesDto,
    @Req() request: Request,
  ): Promise<DriverResponse> {
    return this.driversService.setCapabilities(actor, profileId, dto, this.context(request));
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
