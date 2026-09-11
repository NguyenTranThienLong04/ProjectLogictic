import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class AssignWarehouseStaffDto {
  @ApiProperty({ description: 'User ID of the staff (must have WAREHOUSE_STAFF role)' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'STF-HAN-001', description: 'Unique staff employee code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'Staff code must contain only uppercase letters, numbers, hyphens or underscores',
  })
  staffCode!: string;
}
