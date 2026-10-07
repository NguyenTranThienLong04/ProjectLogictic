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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CodService } from './cod.service.js';
import { ListCodDto } from './dto/list-cod.dto.js';
import {
  CodReasonDto,
  CodVersionDto,
  CreatePayoutDto,
  SendPayoutDto,
  SubmitRemittanceDto,
} from './dto/cod-commands.dto.js';
@ApiTags('cod')
@ApiBearerAuth()
@Controller('cod')
export class CodController {
  constructor(private readonly cod: CodService) {}
  @Post('shipments/:shipmentId/remit')
  @Roles(UserRole.DRIVER)
  @HttpCode(HttpStatus.OK)
  remit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: SubmitRemittanceDto,
    @Req() req: Request,
  ) {
    return this.cod.remit(actor, shipmentId, dto, this.context(req));
  }
  @Get('dashboard')
  @Roles(UserRole.ADMIN)
  dashboard(@Query() query: ListCodDto) {
    return this.cod.dashboard(query);
  }
  @Get('mine')
  @Roles(UserRole.DRIVER)
  mine(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListCodDto) {
    return this.cod.mine(actor, query);
  }
  @Post(':id/settle')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  settle(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.cod.settle(actor, id, this.context(req));
  }
  @Post('remittances/:id/confirm')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  confirmRemittance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CodVersionDto,
    @Req() req: Request,
  ) {
    return this.cod.reviewRemittance(actor, id, dto, true, this.context(req));
  }

  @Post('remittances/:id/reject')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  rejectRemittance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CodReasonDto,
    @Req() req: Request,
  ) {
    return this.cod.reviewRemittance(actor, id, dto, false, this.context(req));
  }

  @Post(':id/payout')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  createPayout(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePayoutDto,
    @Req() req: Request,
  ) {
    return this.cod.createPayout(actor, id, dto, this.context(req));
  }

  @Post('payouts/:id/send')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  sendPayout(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendPayoutDto,
    @Req() req: Request,
  ) {
    return this.cod.sendPayout(actor, id, dto, this.context(req));
  }

  @Post('payouts/:id/confirm')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  confirmPayout(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CodVersionDto,
    @Req() req: Request,
  ) {
    return this.cod.acknowledgePayout(actor, id, dto, true, this.context(req));
  }

  @Post('payouts/:id/dispute')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  disputePayout(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CodReasonDto,
    @Req() req: Request,
  ) {
    return this.cod.acknowledgePayout(actor, id, dto, false, this.context(req));
  }

  @Get('shipments/:id')
  @Roles(UserRole.CUSTOMER)
  customerDetail(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cod.customerDetail(actor, id);
  }

  private context(req: Request): ClientContext {
    return { ipAddress: req.ip, userAgent: req.get('user-agent') };
  }
}
