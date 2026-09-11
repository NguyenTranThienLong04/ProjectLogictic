import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsUUID, Max, Min } from 'class-validator';

export class LineHaulPlanningRecommendationsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  originWarehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  destinationWarehouseId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  earliestStartAt!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  latestEndAt!: string;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxRecommendations = 5;
}
