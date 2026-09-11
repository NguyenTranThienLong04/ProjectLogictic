import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { LineHaulPlanningRecommendationsDto } from './dto/line-haul-planning-recommendations.dto.js';
import { LineHaulPlanningService } from './line-haul-planning.service.js';

@ApiTags('line-haul planning')
@ApiBearerAuth()
@Controller('line-haul/planning')
export class LineHaulPlanningController {
  constructor(private readonly planning: LineHaulPlanningService) {}

  @Get('recommendations')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({
    summary: 'Rank advisory-only deterministic line-haul plans for dispatcher review',
  })
  recommendations(@Query() query: LineHaulPlanningRecommendationsDto) {
    return this.planning.recommendations(query);
  }
}
