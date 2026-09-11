import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ReceiveTransferDto {
  @ApiPropertyOptional({ example: 'Đã nhận đủ hàng tại kho đích, kiện hàng nguyên seal' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ example: 1500, description: 'Verified weight at receiving warehouse' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  actualWeightGrams?: number;
}
