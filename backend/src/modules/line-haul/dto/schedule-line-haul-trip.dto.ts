import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, Min } from 'class-validator';

export class ScheduleLineHaulTripDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  scheduledStartAt!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  scheduledEndAt!: string;
}
