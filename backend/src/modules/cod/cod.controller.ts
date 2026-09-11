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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, ClientContext } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CodService } from './cod.service.js';
import { RemitCodDto } from './dto/remit-cod.dto.js';
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
    @Body() dto: RemitCodDto,
    @Req() req: Request,
  ) {
    return this.cod.remit(actor, shipmentId, dto.amount, this.context(req));
  }
  @Get('dashboard') @Roles(UserRole.ADMIN) dashboard() {
    return this.cod.dashboard();
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
  private context(req: Request): ClientContext {
    return { ipAddress: req.ip, userAgent: req.get('user-agent') };
  }
}
