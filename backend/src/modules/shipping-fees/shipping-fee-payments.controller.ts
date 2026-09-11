import {
  BadRequestException,
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
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateShippingFeePaymentDto } from './dto/create-shipping-fee-payment.dto.js';
import { ShippingFeePaymentsService } from './payments/shipping-fee-payments.service.js';

@ApiTags('shipping-fee-payments')
@Controller('shipping-fee-payments')
export class ShippingFeePaymentsController {
  constructor(private readonly payments: ShippingFeePaymentsService) {}

  @Get('shipments/:shipmentId')
  @ApiBearerAuth()
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({
    summary: 'Read online-payment availability and latest status for an owned shipment',
  })
  getForShipment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
  ) {
    return this.payments.getForShipment(actor, shipmentId);
  }

  @Post()
  @ApiBearerAuth()
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Create an idempotent provider-neutral shipping-fee payment' })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateShippingFeePaymentDto,
    @Req() request: Request,
  ) {
    return this.payments.create(actor, dto, this.context(request));
  }

  @Get('results/:reference')
  @ApiBearerAuth()
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Read payment result without mutating payment state' })
  getResult(@CurrentUser() actor: AuthenticatedUser, @Param('reference') reference: string) {
    return this.payments.getResult(actor, reference);
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive the authoritative signed payment-provider webhook' })
  webhook(@Req() request: RawBodyRequest<Request>) {
    if (!request.rawBody) {
      throw new BadRequestException({
        code: 'SHIPPING_FEE_PAYMENT_WEBHOOK_RAW_BODY_REQUIRED',
        message: 'Payment webhook raw body is required for signature verification',
      });
    }
    return this.payments.handleWebhook(request.rawBody, request.headers, this.context(request));
  }

  private context(request: Request): ClientContext {
    return { ipAddress: request.ip, userAgent: request.get('user-agent') };
  }
}
