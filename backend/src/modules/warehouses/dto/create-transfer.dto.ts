import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({ description: 'Shipment UUID to transfer' })
  @IsUUID()
  shipmentId!: string;

  @ApiProperty({ description: 'Destination Warehouse UUID' })
  @IsUUID()
  toWarehouseId!: string;

  @ApiPropertyOptional({ example: 'Chuyến xe trung chuyển liên tỉnh đêm' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ description: 'Client request UUID for idempotency' })
  @IsUUID()
  @IsNotEmpty()
  clientRequestId!: string;
}
