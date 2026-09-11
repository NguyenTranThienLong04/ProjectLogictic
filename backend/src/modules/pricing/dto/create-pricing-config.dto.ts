import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class CreatePricingConfigDto {
  @ApiProperty({ example: 30000, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  baseFee!: number;

  @ApiProperty({ example: 1000, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  includedWeightGrams!: number;

  @ApiProperty({ example: 5000, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  extraWeightFeePerKg!: number;

  @ApiProperty({ example: 50, description: '0.5% = 50 basis points', minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  codFeeBasisPoints!: number;
}
