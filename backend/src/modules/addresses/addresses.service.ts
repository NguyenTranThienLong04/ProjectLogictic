import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateAddressDto } from './dto/create-address.dto.js';
import type { UpdateAddressDto } from './dto/update-address.dto.js';
import { AddressResponse } from './address.response.js';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: string): Promise<AddressResponse[]> {
    const addresses = await this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return addresses.map((address) => AddressResponse.fromAddress(address));
  }

  async create(customerId: string, dto: CreateAddressDto): Promise<AddressResponse> {
    try {
      const address = await this.prisma.$transaction(async (transaction) => {
        const addressCount = await transaction.customerAddress.count({ where: { customerId } });
        const isDefault = dto.isDefault === true || addressCount === 0;

        if (isDefault) {
          await transaction.customerAddress.updateMany({
            where: { customerId, isDefault: true },
            data: { isDefault: false },
          });
        }

        return transaction.customerAddress.create({
          data: {
            customerId,
            ...this.normalizeCreate(dto),
            isDefault,
          },
        });
      });
      return AddressResponse.fromAddress(address);
    } catch (error) {
      this.rethrowConstraintError(error);
    }
  }

  async update(
    customerId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ): Promise<AddressResponse> {
    try {
      const address = await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.customerAddress.findFirst({
          where: { id: addressId, customerId },
        });
        if (!current) {
          throw this.notFound();
        }
        if (current.isDefault && dto.isDefault === false) {
          throw new ConflictException({
            code: 'ADDRESS_DEFAULT_REQUIRED',
            message: 'Choose another default address before unsetting this one',
          });
        }

        if (dto.isDefault === true && !current.isDefault) {
          await transaction.customerAddress.updateMany({
            where: { customerId, isDefault: true },
            data: { isDefault: false },
          });
        }

        return transaction.customerAddress.update({
          where: { id: addressId },
          data: {
            ...this.normalizeUpdate(dto),
            ...(dto.isDefault === undefined ? {} : { isDefault: dto.isDefault }),
          },
        });
      });
      return AddressResponse.fromAddress(address);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      this.rethrowConstraintError(error);
    }
  }

  async remove(customerId: string, addressId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.customerAddress.findFirst({
        where: { id: addressId, customerId },
      });
      if (!current) {
        throw this.notFound();
      }

      await transaction.customerAddress.delete({ where: { id: addressId } });
      if (current.isDefault) {
        const replacement = await transaction.customerAddress.findFirst({
          where: { customerId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (replacement) {
          await transaction.customerAddress.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }
    });
  }

  private normalizeCreate(
    dto: CreateAddressDto,
  ): Omit<Prisma.CustomerAddressUncheckedCreateInput, 'customerId' | 'isDefault'> {
    return {
      label: dto.label.trim(),
      contactName: dto.contactName.trim(),
      phone: dto.phone.trim(),
      streetAddress: dto.streetAddress.trim(),
      ward: dto.ward.trim(),
      district: dto.district.trim(),
      city: dto.city.trim(),
      ...(dto.latitude === undefined ? {} : { latitude: dto.latitude }),
      ...(dto.longitude === undefined ? {} : { longitude: dto.longitude }),
    };
  }

  private normalizeUpdate(dto: UpdateAddressDto): Prisma.CustomerAddressUpdateInput {
    return {
      ...(dto.label === undefined ? {} : { label: dto.label.trim() }),
      ...(dto.contactName === undefined ? {} : { contactName: dto.contactName.trim() }),
      ...(dto.phone === undefined ? {} : { phone: dto.phone.trim() }),
      ...(dto.streetAddress === undefined ? {} : { streetAddress: dto.streetAddress.trim() }),
      ...(dto.ward === undefined ? {} : { ward: dto.ward.trim() }),
      ...(dto.district === undefined ? {} : { district: dto.district.trim() }),
      ...(dto.city === undefined ? {} : { city: dto.city.trim() }),
      ...(dto.latitude === undefined ? {} : { latitude: dto.latitude }),
      ...(dto.longitude === undefined ? {} : { longitude: dto.longitude }),
    };
  }

  private rethrowConstraintError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException({
        code: 'ADDRESS_DEFAULT_CONFLICT',
        message: 'Another address is already the default; retry the request',
      });
    }
    throw error;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'ADDRESS_NOT_FOUND',
      message: 'Address was not found',
    });
  }
}
