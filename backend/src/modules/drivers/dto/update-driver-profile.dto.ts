import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class UpdateDriverProfileDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Active operating warehouse' })
  @IsOptional()
  @IsUUID()
  operatingWarehouseId?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(2, 50)
  vehicleType?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @Length(4, 20)
  vehiclePlate?: string;

  @ApiPropertyOptional({ description: 'Suspend or restore this driver profile' })
  @IsOptional()
  @IsBoolean()
  suspended?: boolean;
}
