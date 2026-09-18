import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateAddressDto {
  @ApiProperty({ example: 'Nhà riêng', minLength: 1, maxLength: 50 })
  @IsString()
  @Length(1, 50)
  @Matches(/\S/)
  label!: string;

  @ApiProperty({ example: 'Nguyễn Văn An', minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  @Matches(/\S/)
  contactName!: string;

  @ApiProperty({ example: '0901234567', maxLength: 20 })
  @Matches(/^\+?[0-9][0-9\s-]{7,18}[0-9]$/)
  phone!: string;

  @ApiProperty({ example: '123 Nguyễn Huệ', minLength: 3, maxLength: 255 })
  @IsString()
  @Length(3, 255)
  @Matches(/\S/)
  streetAddress!: string;

  @ApiProperty({ example: 'Phường Bến Nghé', minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  @Matches(/\S/)
  ward!: string;

  @ApiProperty({
    example: '',
    minLength: 0,
    maxLength: 100,
    description: 'Legacy district; empty for two-level addresses',
  })
  @IsString()
  @Length(0, 100)
  district!: string;

  @ApiProperty({ example: 'Hồ Chí Minh', minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  @Matches(/\S/)
  city!: string;

  @ApiPropertyOptional({ example: 10.7769, minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 106.7009, minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
