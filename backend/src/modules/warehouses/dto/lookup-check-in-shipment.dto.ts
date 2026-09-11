import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LookupCheckInShipmentDto {
  @ApiProperty({ example: 'SHP-20260817-A1B2C3' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  trackingCode!: string;
}
