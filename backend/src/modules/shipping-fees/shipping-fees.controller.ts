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
import { DisputeShippingFeeDto } from './dto/dispute-shipping-fee.dto.js';
import { ListShippingFeesDto } from './dto/list-shipping-fees.dto.js';
import { RemitShippingFeeDto } from './dto/remit-shipping-fee.dto.js';
import { ResolveShippingFeeDisputeDto } from './dto/resolve-shipping-fee-dispute.dto.js';
import { ShippingFeesService } from './shipping-fees.service.js';

@ApiTags('shipping-fees')
@ApiBearerAuth()
@Controller('shipping-fees')
export class ShippingFeesController {
  constructor(private readonly shippingFees: ShippingFeesService) {}

  @Get('mine')
  @Roles(UserRole.DRIVER)
  @ApiOperation({ summary: 'List shipping fees collected by the authenticated Driver' })
  listMine(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListShippingFeesDto) {
    return this.shippingFees.listMine(actor, query);
  }

  @Post(':id/remit')
  @Roles(UserRole.DRIVER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hand over one collected shipping fee using the exact VND amount' })
  remit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemitShippingFeeDto,
    @Req() request: Request,
  ) {
    return this.shippingFees.remit(actor, id, dto.amount, this.context(request));
  }

  @Get('reconciliation')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List and aggregate shipping fees for Admin reconciliation' })
  reconcile(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListShippingFeesDto) {
    return this.shippingFees.reconcile(actor, query);
  }

  @Post(':id/settle')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Settle an exactly remitted shipping fee' })
  settle(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.shippingFees.settle(actor, id, this.context(request));
  }

  @Post(':id/dispute')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open a reasoned dispute on a collected or remitted shipping fee' })
  dispute(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisputeShippingFeeDto,
    @Req() request: Request,
  ) {
    return this.shippingFees.dispute(actor, id, dto.reason, this.context(request));
  }

  @Post(':id/resolve')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve the active dispute and restore its explicit source state' })
  resolve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveShippingFeeDisputeDto,
    @Req() request: Request,
  ) {
    return this.shippingFees.resolveDispute(actor, id, dto.resolutionNote, this.context(request));
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
