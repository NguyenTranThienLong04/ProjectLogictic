import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : value;

export class AddressSearchDto {
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  street!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ward?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  city!: string;
}
