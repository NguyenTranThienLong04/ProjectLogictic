import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WarehouseTransferStatus } from '../../../generated/prisma/client.js';

export class ListIncomingTransfersDto {
  @ApiPropertyOptional({ description: 'Search transfer code or shipment tracking code' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 21474836 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(21474836) // Keep the offset within PostgreSQL/Prisma Int even at limit=100.
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class ListWarehouseTransfersDto extends ListIncomingTransfersDto {
  @ApiPropertyOptional({ enum: ['inbound', 'outbound', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['inbound', 'outbound', 'all'])
  direction: 'inbound' | 'outbound' | 'all' = 'all';

  @ApiPropertyOptional({ enum: WarehouseTransferStatus })
  @IsOptional()
  @IsEnum(WarehouseTransferStatus)
  status?: WarehouseTransferStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  shipmentId?: string;
}
