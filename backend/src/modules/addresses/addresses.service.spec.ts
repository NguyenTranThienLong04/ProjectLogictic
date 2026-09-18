import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Prisma, type CustomerAddress } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { AddressesService } from './addresses.service.js';
import type { CreateAddressDto } from './dto/create-address.dto.js';

const customerId = '5e9f691b-dc19-4df0-81f0-16d276a84d53';
const addressId = '90877224-eed8-4bc3-9e27-377559066631';

function address(overrides: Partial<CustomerAddress> = {}): CustomerAddress {
  const now = new Date('2026-08-17T05:00:00.000Z');
  return {
    id: addressId,
    customerId,
    label: 'Nhà riêng',
    contactName: 'Nguyễn Văn An',
    phone: '0901234567',
    streetAddress: '123 Nguyễn Huệ',
    ward: 'Phường Bến Nghé',
    district: 'Quận 1',
    city: 'Hồ Chí Minh',
    latitude: null,
    longitude: null,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const createDto: CreateAddressDto = {
  label: ' Nhà riêng ',
  contactName: ' Nguyễn Văn An ',
  phone: ' 0901234567 ',
  streetAddress: ' 123 Nguyễn Huệ ',
  ward: ' Phường Bến Nghé ',
  district: ' Quận 1 ',
  city: ' Hồ Chí Minh ',
  isDefault: false,
};

describe('AddressesService', () => {
  it('preserves coordinates through create, edit and list responses', async () => {
    let stored = address();
    const write = ({ data }: { data: { latitude?: number; longitude?: number } }) => {
      stored = {
        ...stored,
        latitude: new Prisma.Decimal(data.latitude!),
        longitude: new Prisma.Decimal(data.longitude!),
      };
      return Promise.resolve(stored);
    };
    const transaction = {
      customerAddress: {
        count: jest.fn(() => Promise.resolve(1)),
        create: jest.fn(write),
        update: jest.fn(write),
        findFirst: jest.fn(() => Promise.resolve(stored)),
        findMany: jest.fn(() => Promise.resolve([stored])),
      },
    };
    const service = new AddressesService({
      ...transaction,
      $transaction: (callback: (client: typeof transaction) => unknown) => callback(transaction),
    } as unknown as PrismaService);
    expect(
      await service.create(customerId, { ...createDto, latitude: 10.7769, longitude: 106.7009 }),
    ).toMatchObject({ latitude: 10.7769, longitude: 106.7009 });
    expect(transaction.customerAddress.create.mock.calls[0]?.[0].data).toMatchObject({
      latitude: 10.7769,
      longitude: 106.7009,
    });
    expect(
      await service.update(customerId, addressId, { latitude: 21.0285, longitude: 105.8542 }),
    ).toMatchObject({ latitude: 21.0285, longitude: 105.8542 });
    expect((await service.list(customerId))[0]).toMatchObject({
      latitude: 21.0285,
      longitude: 105.8542,
    });
  });

  it('scopes address lists to the authenticated customer', async () => {
    const findMany = jest.fn(() => Promise.resolve([address()]));
    const service = new AddressesService({
      customerAddress: { findMany },
    } as unknown as PrismaService);

    const result = await service.list(customerId);

    expect(findMany).toHaveBeenCalledWith({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    expect(result[0]).not.toHaveProperty('customerId');
  });

  it('makes the first address default and normalizes snapshot-ready text', async () => {
    const transaction = {
      customerAddress: {
        count: jest.fn(() => Promise.resolve(0)),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
        create: jest.fn(() => Promise.resolve(address())),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new AddressesService(prisma);

    await service.create(customerId, createDto);

    expect(transaction.customerAddress.updateMany).toHaveBeenCalledWith({
      where: { customerId, isDefault: true },
      data: { isDefault: false },
    });
    expect(transaction.customerAddress.create).toHaveBeenCalledWith({
      data: {
        customerId,
        label: 'Nhà riêng',
        contactName: 'Nguyễn Văn An',
        phone: '0901234567',
        streetAddress: '123 Nguyễn Huệ',
        ward: 'Phường Bến Nghé',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
        isDefault: true,
      },
    });
  });

  it('does not allow a customer to update another customer address', async () => {
    const transaction = {
      customerAddress: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new AddressesService(prisma);

    await expect(
      service.update(customerId, addressId, { label: 'Công ty' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.customerAddress.findFirst).toHaveBeenCalledWith({
      where: { id: addressId, customerId },
    });
    expect(transaction.customerAddress.update).not.toHaveBeenCalled();
  });

  it('promotes a replacement when deleting the default address', async () => {
    const replacementId = '4acf452b-cd62-4820-a67d-4e740327ca35';
    const transaction = {
      customerAddress: {
        findFirst: jest
          .fn<() => Promise<CustomerAddress | { id: string } | null>>()
          .mockResolvedValueOnce(address())
          .mockResolvedValueOnce({ id: replacementId }),
        delete: jest.fn(() => Promise.resolve(address())),
        update: jest.fn(() => Promise.resolve(address({ id: replacementId }))),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new AddressesService(prisma);

    await service.remove(customerId, addressId);

    expect(transaction.customerAddress.delete).toHaveBeenCalledWith({ where: { id: addressId } });
    expect(transaction.customerAddress.update).toHaveBeenCalledWith({
      where: { id: replacementId },
      data: { isDefault: true },
    });
  });
});
