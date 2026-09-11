import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS } from '../line-haul-capacity.js';

export class UpdateLineHaulVehicleCapacityDto {
  @ApiProperty({ minimum: 1, maximum: MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS })
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_HAUL_CAPACITY_WEIGHT_GRAMS)
  capacityWeightGrams!: number;
}
