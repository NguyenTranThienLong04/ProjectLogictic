import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetDriverAvailabilityDto {
  @ApiProperty()
  @IsBoolean()
  isOnline!: boolean;
}
