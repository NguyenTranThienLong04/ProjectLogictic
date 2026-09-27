import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CODPayoutMethod } from '../../../generated/prisma/client.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CodVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  expectedVersion!: number;
}

export class SubmitRemittanceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  amount!: number;

  @IsUUID()
  clientRequestId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CodReasonDto extends CodVersionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class CreatePayoutDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  amount!: number;

  @IsEnum(CODPayoutMethod)
  method!: CODPayoutMethod;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SendPayoutDto extends CodVersionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reference!: string;
}
