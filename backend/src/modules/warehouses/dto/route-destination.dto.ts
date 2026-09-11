import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class RouteDestinationDto {
  @ApiProperty({ description: 'Target destination warehouse UUID' })
  @IsUUID()
  @IsNotEmpty()
  destinationWarehouseId!: string;
}
