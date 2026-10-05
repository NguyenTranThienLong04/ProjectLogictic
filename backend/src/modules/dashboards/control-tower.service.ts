import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import {
  ControlTowerQueryDto,
  CONTROL_TOWER_STAGES,
  CONTROL_TOWER_STATUSES,
} from './control-tower-query.dto.js';
import { controlTowerPolicy } from './control-tower.policy.js';
import { controlTowerQuery } from './control-tower.query.js';
import type { ControlTowerSnapshot } from './control-tower.response.js';

@Injectable()
export class ControlTowerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  filters() {
    return {
      statuses: CONTROL_TOWER_STATUSES,
      stages: CONTROL_TOWER_STAGES,
      slaStates: ['ON_TIME', 'AT_RISK', 'OVERDUE', 'UNAVAILABLE'],
      policy: controlTowerPolicy(this.config),
    };
  }

  async dashboard(query: ControlTowerQueryDto) {
    if (query.from && query.to && new Date(query.from) >= new Date(query.to)) {
      throw new BadRequestException({
        code: 'CONTROL_TOWER_DATE_RANGE_INVALID',
        message: 'from must be earlier than to',
      });
    }
    const policy = controlTowerPolicy(this.config);
    const [snapshot] = await this.prisma.$queryRaw<ControlTowerSnapshot[]>(
      controlTowerQuery(query, policy),
    );
    return {
      ...snapshot,
      policy,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: snapshot.total,
        totalPages: Math.ceil(snapshot.total / query.limit),
      },
    };
  }
}
