import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CODPayoutStatus, CODTransactionStatus } from '../../../generated/prisma/client.js';

const payoutStates = [...Object.values(CODPayoutStatus), 'NONE'];

export class ListCodDto {
  @ApiPropertyOptional({ enum: CODTransactionStatus })
  @IsOptional()
  @IsEnum(CODTransactionStatus)
  status?: CODTransactionStatus;

  @ApiPropertyOptional({ enum: payoutStates, description: 'Admin only; NONE means no payout yet' })
  @IsOptional()
  @IsIn(payoutStates)
  payoutStatus?: CODPayoutStatus | 'NONE';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    default: 100,
    minimum: 1,
    maximum: 100,
    description:
      'Defaults to the legacy 100-item window; paginated clients may request a smaller limit',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 100;
}
