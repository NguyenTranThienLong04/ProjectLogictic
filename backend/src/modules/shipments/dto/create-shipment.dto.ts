import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { ShippingFeePayer } from '../../../generated/prisma/client.js';
import { QuoteAddressDto } from '../../pricing/dto/quote-address.dto.js';
import { PackageDto } from './package.dto.js';

export class CreateShipmentDto {
  @ApiProperty({ format: 'uuid', description: 'Stable client-generated idempotency key' })
  @IsUUID()
  clientRequestId!: string;

  @ApiProperty({ format: 'uuid', description: 'Owned saved pickup address' })
  @IsUUID()
  pickupAddressId!: string;

  @ApiProperty({ type: QuoteAddressDto })
  @ValidateNested()
  @Type(() => QuoteAddressDto)
  deliveryAddress!: QuoteAddressDto;

  @ApiProperty({ type: PackageDto })
  @ValidateNested()
  @Type(() => PackageDto)
  package!: PackageDto;

  @ApiProperty({ example: 0, minimum: 0, maximum: 1000000000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  codAmount!: number;

  @ApiProperty({
    enum: ShippingFeePayer,
    description: 'Immutable responsibility snapshot for the shipment shipping fee',
  })
  @IsEnum(ShippingFeePayer)
  shippingFeePayer!: ShippingFeePayer;
}
