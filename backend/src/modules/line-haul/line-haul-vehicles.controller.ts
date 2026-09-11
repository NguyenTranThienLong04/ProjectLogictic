import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateLineHaulVehicleDto } from './dto/create-line-haul-vehicle.dto.js';
import { ListLineHaulVehiclesDto } from './dto/list-line-haul-vehicles.dto.js';
import { UpdateLineHaulVehicleCapacityDto } from './dto/update-line-haul-vehicle-capacity.dto.js';
import { LineHaulVehiclesService } from './line-haul-vehicles.service.js';

@ApiTags('line-haul vehicles')
@ApiBearerAuth()
@Controller('line-haul/vehicles')
export class LineHaulVehiclesController {
  constructor(private readonly vehicles: LineHaulVehiclesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create an available line-haul fleet vehicle' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateLineHaulVehicleDto,
    @Req() request: Request,
  ) {
    return this.vehicles.create(actor, dto, this.context(request));
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'List line-haul fleet vehicles' })
  list(@Query() query: ListLineHaulVehiclesDto) {
    return this.vehicles.list(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Get line-haul fleet vehicle detail' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.get(id);
  }

  @Post(':id/update-capacity')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update line-haul vehicle weight capacity with active-load validation' })
  updateCapacity(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLineHaulVehicleCapacityDto,
    @Req() request: Request,
  ) {
    return this.vehicles.updateCapacity(actor, id, dto, this.context(request));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Return an idle line-haul vehicle to available service' })
  activate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.vehicles.activate(actor, id, this.context(request));
  }

  @Post(':id/mark-maintenance')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Mark an idle line-haul vehicle for maintenance' })
  markMaintenance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.vehicles.markMaintenance(actor, id, this.context(request));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate an idle line-haul vehicle without deleting history' })
  deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.vehicles.deactivate(actor, id, this.context(request));
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
