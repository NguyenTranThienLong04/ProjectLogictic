import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  ShippingFeePayer,
  ShippingFeeTransactionStatus,
} from '../../../generated/prisma/client.js';

export class ListShippingFeesDto {
  @ApiPropertyOptional({ enum: ShippingFeeTransactionStatus })
  @IsOptional()
  @IsEnum(ShippingFeeTransactionStatus)
  status?: ShippingFeeTransactionStatus;

  @ApiPropertyOptional({ enum: ShippingFeePayer })
  @IsOptional()
  @IsEnum(ShippingFeePayer)
  payer?: ShippingFeePayer;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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
