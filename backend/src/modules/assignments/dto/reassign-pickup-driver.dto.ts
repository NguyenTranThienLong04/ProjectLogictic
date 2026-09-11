import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length } from 'class-validator';

export class ReassignPickupDriverDto {
  @ApiProperty({ format: 'uuid', description: 'Client-generated idempotency key' })
  @IsUUID()
  clientRequestId!: string;

  @ApiProperty({ format: 'uuid', description: 'Replacement DriverProfile ID' })
  @IsUUID()
  driverId!: string;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @Length(3, 500)
  reason!: string;
}
