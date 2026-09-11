import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CompleteDeliveryDto {
  @IsString()
  @MaxLength(100)
  receiverName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'Exact integer VND shipping fee when the receiver pays on successful delivery',
    minimum: 1,
    maximum: 2_147_483_647,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  shippingFeeAmount?: number;
}
