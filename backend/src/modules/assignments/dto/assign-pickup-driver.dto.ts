import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignPickupDriverDto {
  @ApiProperty({ format: 'uuid', description: 'Client-generated idempotency key' })
  @IsUUID()
  clientRequestId!: string;

  @ApiProperty({ format: 'uuid', description: 'DriverProfile ID' })
  @IsUUID()
  driverId!: string;
}
