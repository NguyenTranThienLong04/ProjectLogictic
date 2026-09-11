import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../modules/auth/decorators/public.decorator.js';
import { HealthService, type HealthStatus } from './health.service.js';

class HealthChecksResponse {
  database!: 'up' | 'down';
  redis!: 'up' | 'down';
}

class HealthResponse implements HealthStatus {
  status!: 'ok' | 'degraded';
  checks!: HealthChecksResponse;
  timestamp!: string;
}

class LivenessResponse {
  status!: 'ok';
  timestamp!: string;
}

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check API dependency readiness (backward-compatible alias)' })
  @ApiOkResponse({ type: HealthResponse })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable' })
  checkReadiness(): Promise<HealthStatus> {
    return this.health.checkReadiness();
  }

  @Get('live')
  @ApiOperation({ summary: 'Check process liveness without dependency calls' })
  @ApiOkResponse({ type: LivenessResponse })
  checkLiveness(): LivenessResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check API dependency readiness' })
  @ApiOkResponse({ type: HealthResponse })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable' })
  checkExplicitReadiness(): Promise<HealthStatus> {
    return this.health.checkReadiness();
  }
}
