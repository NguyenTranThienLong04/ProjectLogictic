import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DeliveryAttemptStatus, DriverAssignmentStatus } from '../../../generated/prisma/client.js';

export enum DriverDeliveryListView {
  ACTIVE = 'ACTIVE',
  HISTORY = 'HISTORY',
  ALL = 'ALL',
}

export class ListDriverDeliveriesDto {
  @ApiPropertyOptional({ enum: DriverDeliveryListView, default: DriverDeliveryListView.ACTIVE })
  @IsOptional()
  @IsEnum(DriverDeliveryListView)
  view: DriverDeliveryListView = DriverDeliveryListView.ACTIVE;

  @ApiPropertyOptional({ enum: DriverAssignmentStatus })
  @IsOptional()
  @IsEnum(DriverAssignmentStatus)
  status?: DriverAssignmentStatus;

  @ApiPropertyOptional({ enum: DeliveryAttemptStatus })
  @IsOptional()
  @IsEnum(DeliveryAttemptStatus)
  attemptStatus?: DeliveryAttemptStatus;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  fromDate?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  toDate?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
