import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  Min,
  Max,
  ValidateIf,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateWarehouseDto {
  @ApiPropertyOptional({ example: 'Kho Trung Chuyển Hà Nội Mới' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Số 456 Đường Cầu Giấy' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: 'Phường Dịch Vọng Hậu' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ward?: string;

  @ApiPropertyOptional({ example: 'Quận Cầu Giấy' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ example: 'Hà Nội' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 21.028511 })
  @ValidateIf(
    (value: UpdateWarehouseDto) => value.latitude !== undefined || value.longitude !== undefined,
  )
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 105.804817 })
  @ValidateIf(
    (value: UpdateWarehouseDto) => value.latitude !== undefined || value.longitude !== undefined,
  )
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
