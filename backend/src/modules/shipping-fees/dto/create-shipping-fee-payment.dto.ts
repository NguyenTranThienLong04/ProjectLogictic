import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateShippingFeePaymentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  shipmentId!: string;

  @ApiProperty({ format: 'uuid', description: 'Client-generated idempotency key' })
  @IsUUID('4')
  clientRequestId!: string;
}
