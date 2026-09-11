import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

export class CreateDriverProfileDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ format: 'uuid', description: 'Active warehouse defining the driver service area' })
  @IsUUID()
  operatingWarehouseId!: string;

  @ApiProperty({ maxLength: 32 })
  @IsString()
  @Length(2, 32)
  @Matches(/^[A-Za-z0-9_-]+$/)
  employeeCode!: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @Length(2, 50)
  vehicleType!: string;

  @ApiProperty({ maxLength: 20 })
  @IsString()
  @Length(4, 20)
  @MaxLength(20)
  vehiclePlate!: string;
}
