import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { ShipmentsService } from './shipments.service.js';

@ApiTags('tracking')
@Controller('tracking')
export class TrackingController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':trackingCode')
  @ApiOperation({ summary: 'Get public shipment tracking without internal or personal data' })
  @ApiOkResponse({ description: 'Public tracking status and timeline' })
  track(@Param('trackingCode') trackingCode: string) {
    return this.shipmentsService.publicTracking(trackingCode);
  }
}
