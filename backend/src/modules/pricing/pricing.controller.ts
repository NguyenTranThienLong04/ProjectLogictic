import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreatePricingConfigDto } from './dto/create-pricing-config.dto.js';
import { ShippingQuoteDto } from './dto/shipping-quote.dto.js';
import { PricingService } from './pricing.service.js';
import type { PricingBreakdown, PublicPricingConfig } from './pricing.types.js';

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Calculate a server-authoritative shipping quote' })
  @ApiOkResponse({ description: 'Integer VND fee breakdown' })
  @ApiServiceUnavailableResponse({
    description:
      'PRICING_CONFIG_UNAVAILABLE when no active pricing config exists; no fallback quote',
  })
  quote(@Body() dto: ShippingQuoteDto): Promise<PricingBreakdown> {
    return this.pricingService.quote(dto);
  }

  @Get('config')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get the active pricing configuration' })
  @ApiOkResponse({ description: 'Active versioned pricing configuration' })
  @ApiServiceUnavailableResponse({
    description:
      'PRICING_CONFIG_UNAVAILABLE: Admin must explicitly create and activate a pricing config',
  })
  getConfig(): Promise<PublicPricingConfig> {
    return this.pricingService.getActiveConfig();
  }

  @Post('config')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create and activate a new pricing configuration version' })
  @ApiCreatedResponse({ description: 'New active pricing configuration' })
  createConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePricingConfigDto,
  ): Promise<PublicPricingConfig> {
    return this.pricingService.createConfig(user.id, dto);
  }
}
