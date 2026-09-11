import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReceiveReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
