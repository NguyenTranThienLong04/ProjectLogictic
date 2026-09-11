import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class RemitShippingFeeDto {
  @ApiProperty({ description: 'Exact integer VND amount handed over by the collector', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;
}
