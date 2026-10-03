import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../modules/auth/decorators/public.decorator.js';
import { HealthService, type HealthStatus } from './health.service.js';
import {
  getReleaseMetadata,
  type RuntimeReleaseMetadata,
} from '../common/release/release-metadata.js';

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

class VersionResponse implements RuntimeReleaseMetadata {
  @ApiProperty({ description: 'Full build-source commit SHA, or unknown when unavailable' })
  commitSha!: string;
  @ApiProperty({
    description: 'ISO UTC artifact build timestamp, or unknown for an unbuilt process',
  })
  buildTimestamp!: string;
  @ApiProperty({ description: 'Actual runtime Node version' })
  runtimeNodeVersion!: string;
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

  @Get('version')
  @ApiOperation({ summary: 'Read public build identity and runtime Node version' })
  @ApiOkResponse({ type: VersionResponse })
  checkVersion(): RuntimeReleaseMetadata {
    return getReleaseMetadata();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check API dependency readiness' })
  @ApiOkResponse({ type: HealthResponse })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable' })
  checkExplicitReadiness(): Promise<HealthStatus> {
    return this.health.checkReadiness();
  }
}
