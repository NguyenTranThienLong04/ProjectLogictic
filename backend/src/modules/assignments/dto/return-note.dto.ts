import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ReturnNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsUUID()
  returnWarehouseId?: string;
}
