import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsString, Length, Matches, Max, Min } from 'class-validator';

export class PackageDto {
  @ApiProperty({ example: 'Quần áo', minLength: 2, maxLength: 200 })
  @IsString()
  @Length(2, 200)
  @Matches(/\S/)
  description!: string;

  @ApiProperty({ example: 'PARCEL', minLength: 2, maxLength: 50 })
  @IsString()
  @Length(2, 50)
  @Matches(/\S/)
  packageType!: string;

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
}
