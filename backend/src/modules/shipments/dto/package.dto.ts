import { PackageDimensionsDto } from '../../../common/dto/package-dimensions.dto.js';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

export class PackageDto extends PackageDimensionsDto {
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
}
