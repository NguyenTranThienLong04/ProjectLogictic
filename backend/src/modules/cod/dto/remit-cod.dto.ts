import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class RemitCodDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amount!: number;
}
