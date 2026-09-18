import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAddressDto } from './create-address.dto.js';
import { UpdateAddressDto } from './update-address.dto.js';

describe('Saved address coordinate validation', () => {
  it.each([CreateAddressDto, UpdateAddressDto])('rejects coordinate strings in %p', async (dto) => {
    const value = plainToInstance(dto, { latitude: '10.878105', longitude: '106.810129' });
    const errors = await validate(value);
    expect(
      errors.filter((error) => error.constraints?.isNumber).map((error) => error.property),
    ).toEqual(expect.arrayContaining(['latitude', 'longitude']));
  });
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
    ['latitude', 10.7695084],
    ['longitude', 106.6907953],
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
