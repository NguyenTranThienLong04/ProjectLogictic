import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { DriverCapability } from '../../../generated/prisma/client.js';

export class SetDriverCapabilitiesDto {
  @ApiProperty({ enum: DriverCapability, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(DriverCapability, { each: true })
  capabilities!: DriverCapability[];
}
