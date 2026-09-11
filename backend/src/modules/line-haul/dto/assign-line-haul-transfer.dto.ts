import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignLineHaulTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  transferId!: string;
}
