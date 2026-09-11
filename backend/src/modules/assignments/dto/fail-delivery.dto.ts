import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DeliveryFailureReason } from '../../../generated/prisma/client.js';

export class FailDeliveryDto {
  @IsEnum(DeliveryFailureReason)
  reason!: DeliveryFailureReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
