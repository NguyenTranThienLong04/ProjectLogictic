import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsNumber,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class QuoteAddressDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  @Matches(/\S/)
  contactName!: string;

  @ApiProperty({ example: '0901234567' })
  @Matches(/^\+?[0-9][0-9\s-]{7,18}[0-9]$/)
  phone!: string;

  @ApiProperty({ minLength: 3, maxLength: 255 })
  @IsString()
  @Length(3, 255)
  @Matches(/\S/)
  streetAddress!: string;

  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  @Matches(/\S/)
  ward!: string;

  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  @Matches(/\S/)
  district!: string;

  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  @Matches(/\S/)
  city!: string;

  @ApiPropertyOptional({ example: 10.7769, minimum: -90, maximum: 90 })
  @ValidateIf(
    (address: QuoteAddressDto) => address.latitude !== undefined || address.longitude !== undefined,
  )
  @IsDefined()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 106.7009, minimum: -180, maximum: 180 })
  @ValidateIf(
    (address: QuoteAddressDto) => address.latitude !== undefined || address.longitude !== undefined,
  )
  @IsDefined()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;
}
