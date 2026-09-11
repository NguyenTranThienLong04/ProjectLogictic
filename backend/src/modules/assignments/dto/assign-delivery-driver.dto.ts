import { IsUUID } from 'class-validator';

export class AssignDeliveryDriverDto {
  @IsUUID()
  driverId!: string;

  @IsUUID()
  clientRequestId!: string;
}
