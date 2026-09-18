import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAddressDto } from './create-address.dto.js';

describe('Saved address coordinate validation', () => {
  it.each(['', 'Quận 1'])('accepts current/legacy district %j', async (district) => {
    const errors = await validate(plainToInstance(CreateAddressDto, { district }));
    expect(errors.some((error) => error.property === 'district')).toBe(false);
  });
  it.each([null, 123, 'x'.repeat(101)])('rejects invalid district %j', async (district) => {
    const errors = await validate(plainToInstance(CreateAddressDto, { district }));
    expect(errors.some((error) => error.property === 'district')).toBe(true);
  });
  it.each([
    ['latitude', -91],
    ['latitude', 91],
    ['longitude', -181],
    ['longitude', 181],
    ['latitude', NaN],
    ['longitude', NaN],
    ['latitude', Infinity],
    ['longitude', Infinity],
    ['latitude', -Infinity],
    ['longitude', -Infinity],
  ])('rejects %s = %s', async (field, value) => {
    const errors = await validate(plainToInstance(CreateAddressDto, { [field]: value }));
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
