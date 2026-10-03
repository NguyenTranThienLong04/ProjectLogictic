import { PackageDimensionsDto } from '../../../common/dto/package-dimensions.dto.js';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, Min, ValidateNested, Length } from 'class-validator';
import { QuoteAddressDto } from './quote-address.dto.js';

export class ShippingQuoteDto extends PackageDimensionsDto {
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
