import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWarehouseDto } from './create-warehouse.dto.js';
import { UpdateWarehouseDto } from './update-warehouse.dto.js';

describe.each([CreateWarehouseDto, UpdateWarehouseDto])('%s coordinate contract', (Dto) => {
  const base = {
    code: 'WH-TEST',
    name: 'Test warehouse',
    address: '123 Street',
    city: 'Hà Nội',
    ward: 'Test ward',
    district: '',
  };
  it('accepts two-level address and numeric canonical pair', async () => {
    expect(
      await validate(plainToInstance(Dto, { ...base, latitude: 21.028511, longitude: 105.804817 })),
    ).toHaveLength(0);
    expect(await validate(plainToInstance(Dto, base))).toHaveLength(0);
  });
  it.each([
    { latitude: 91, longitude: 105 },
    { latitude: 21, longitude: -181 },
    { latitude: '21', longitude: '105' },
    { latitude: 21.1234567, longitude: 105 },
    { latitude: NaN, longitude: 105 },
    { latitude: Infinity, longitude: 105 },
    { latitude: 21 },
    { longitude: 105 },
    { latitude: null, longitude: null },
  ])('rejects invalid or incomplete pair %j', async (coordinate) => {
    expect(
      (await validate(plainToInstance(Dto, { ...base, ...coordinate }))).length,
    ).toBeGreaterThan(0);
  });
});
