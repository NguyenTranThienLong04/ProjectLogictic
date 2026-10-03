import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class PackageDimensionsDto {
  @ApiProperty({ example: 20, minimum: 1, maximum: 300, multipleOf: 0.1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(300)
  lengthCm!: number;

  @ApiProperty({ example: 14.8, minimum: 1, maximum: 300, multipleOf: 0.1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(300)
  widthCm!: number;

  @ApiProperty({ example: 10, minimum: 1, maximum: 300, multipleOf: 0.1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(300)
  heightCm!: number;
}
