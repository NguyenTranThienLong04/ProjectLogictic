import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CustomerAddress } from '../../generated/prisma/client.js';

export class AddressResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  contactName!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty()
  streetAddress!: string;

  @ApiProperty()
  ward!: string;

  @ApiProperty()
  district!: string;

  @ApiProperty()
  city!: string;

  @ApiPropertyOptional({ nullable: true })
  latitude!: number | null;

  @ApiPropertyOptional({ nullable: true })
  longitude!: number | null;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromAddress(address: CustomerAddress): AddressResponse {
    return {
      id: address.id,
      label: address.label,
      contactName: address.contactName,
      phone: address.phone,
      streetAddress: address.streetAddress,
      ward: address.ward,
      district: address.district,
      city: address.city,
      latitude: address.latitude === null ? null : Number(address.latitude),
      longitude: address.longitude === null ? null : Number(address.longitude),
      isDefault: address.isDefault,
      createdAt: address.createdAt,
      updatedAt: address.updatedAt,
    };
  }
}
