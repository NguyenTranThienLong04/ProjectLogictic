import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAddressDto } from './create-address.dto.js';

describe('Saved address coordinate validation', () => {
  it.each([
    ['latitude', -91],
    ['latitude', 91],
    ['longitude', -181],
    ['longitude', 181],
    ['latitude', NaN],
    ['longitude', Infinity],
  ])('rejects %s = %s', async (field, value) => {
    const errors = await validate(plainToInstance(CreateAddressDto, { [field]: value }));
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
