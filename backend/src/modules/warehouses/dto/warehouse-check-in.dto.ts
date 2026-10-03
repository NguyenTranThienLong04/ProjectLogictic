import { PackageDimensionsDto } from '../../../common/dto/package-dimensions.dto.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class WarehouseCheckInDto extends PackageDimensionsDto {
  @ApiPropertyOptional({ example: 'SHP-20260817-A1B2C3', description: 'Tracking code to check in' })
  @IsOptional()
  @IsString()
  trackingCode?: string;

  @ApiPropertyOptional({ description: 'Shipment UUID to check in' })
  @IsOptional()
  @IsUUID()
  shipmentId?: string;

  @ApiProperty({ example: true, description: 'Explicit package verification confirmation' })
  @Equals(true)
  packageVerified!: true;

  @ApiProperty({ example: 1500, description: 'Verified actual weight in grams' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  actualWeightGrams!: number;

  @ApiPropertyOptional({ example: 'Gói hàng nguyên vẹn, đã dán barcode phân loại' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
