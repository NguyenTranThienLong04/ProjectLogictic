import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SHIPMENT_STAGES } from './control-tower.policy.js';

export const CONTROL_TOWER_STATUSES = [
  ...Object.keys(SHIPMENT_STAGES).filter(
    (status) => SHIPMENT_STAGES[status as keyof typeof SHIPMENT_STAGES] !== 'TERMINAL',
  ),
  'PLANNED',
  'READY',
];
export const CONTROL_TOWER_STAGES = [...new Set(Object.values(SHIPMENT_STAGES))]
  .filter((stage) => stage !== 'TERMINAL')
  .concat(['PLANNED', 'READY']);
export const CONTROL_TOWER_SORTS = [
  'PRIORITY',
  'AGING_DESC',
  'DEADLINE_ASC',
  'CREATED_DESC',
  'CODE_ASC',
] as const;

export class ControlTowerQueryDto {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(CONTROL_TOWER_STATUSES) status?: string;
  @IsOptional() @IsIn(CONTROL_TOWER_STAGES) stage?: string;
  @IsOptional() @IsIn(['ON_TIME', 'AT_RISK', 'OVERDUE', 'UNAVAILABLE']) slaState?: string;
  @IsOptional() @IsIn(['ALL', 'SHIPMENT', 'TRIP']) entityType: 'ALL' | 'SHIPMENT' | 'TRIP' = 'ALL';
  @IsOptional() @IsIn(['true', 'false']) exceptionsOnly?: string;
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  // Explicit instants; from inclusive, to exclusive, applied to entity.createdAt.
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) to?: string;
  @IsOptional() @IsIn(CONTROL_TOWER_SORTS) sort: (typeof CONTROL_TOWER_SORTS)[number] = 'PRIORITY';
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}
