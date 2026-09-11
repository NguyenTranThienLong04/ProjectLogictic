import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import { MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS } from '../line-haul-capacity.js';

export class CreateLineHaulVehicleDto {
  @ApiProperty({ maxLength: 32 })
  @IsString()
  @Length(2, 32)
  @Matches(/^[A-Za-z0-9_-]+$/)
  vehicleCode!: string;

  @ApiProperty({ maxLength: 20 })
  @IsString()
  @Length(4, 20)
  licensePlate!: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @Length(2, 50)
  vehicleType!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS })
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS)
  capacityWeightGrams!: number;
}
