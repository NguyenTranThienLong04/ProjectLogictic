import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsString, Max, Min, ValidateNested, Length } from 'class-validator';
import { QuoteAddressDto } from './quote-address.dto.js';

export class ShippingQuoteDto {
  @ApiProperty({ type: QuoteAddressDto })
  @ValidateNested()
  @Type(() => QuoteAddressDto)
  pickup!: QuoteAddressDto;

  @ApiProperty({ type: QuoteAddressDto })
  @ValidateNested()
  @Type(() => QuoteAddressDto)
  delivery!: QuoteAddressDto;

  @ApiProperty({ example: 1500, minimum: 1, maximum: 100000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  weightGrams!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 300 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(300)
  lengthCm!: number;

  @ApiProperty({ example: 15, minimum: 1, maximum: 300 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(300)
  widthCm!: number;

  @ApiProperty({ example: 10, minimum: 1, maximum: 300 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(300)
  heightCm!: number;

  @ApiProperty({ example: 'PARCEL', minLength: 2, maxLength: 50 })
  @IsString()
  @Length(2, 50)
  packageType!: string;

  @ApiProperty({ example: 1000000, minimum: 0, maximum: 1000000000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  codAmount!: number;
}
