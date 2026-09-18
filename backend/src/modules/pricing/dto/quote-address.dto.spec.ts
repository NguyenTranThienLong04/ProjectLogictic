import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuoteAddressDto } from './quote-address.dto.js';

const validAddress = {
  contactName: 'Nguyễn Văn An',
  phone: '0901234567',
  streetAddress: '123 Nguyễn Huệ',
  ward: 'Bến Nghé',
  district: 'Quận 1',
  city: 'Hồ Chí Minh',
};

describe('QuoteAddressDto coordinates', () => {
  it('accepts omitted optional delivery coordinates', async () => {
    await expect(validate(plainToInstance(QuoteAddressDto, validAddress))).resolves.toHaveLength(0);
  });

  it.each([
    { latitude: 10, longitude: null },
    { latitude: null, longitude: 106 },
    { longitude: 106 },
    { latitude: -91, longitude: 106 },
    { latitude: 10, longitude: -181 },
    { latitude: NaN, longitude: 106 },
    { latitude: Infinity, longitude: 106 },
    { latitude: 10, longitude: NaN },
    { latitude: 10, longitude: Infinity },
  ])('rejects invalid coordinate pair %j', async (coordinate) => {
    const errors = await validate(
      plainToInstance(QuoteAddressDto, { ...validAddress, ...coordinate }),
    );
    expect(errors.some((error) => ['latitude', 'longitude'].includes(error.property))).toBe(true);
  });
  it('accepts an optional complete receiver coordinate pair', async () => {
    const dto = plainToInstance(QuoteAddressDto, {
      ...validAddress,
      latitude: 10.7769,
      longitude: 106.7009,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a partial receiver coordinate pair', async () => {
    const dto = plainToInstance(QuoteAddressDto, { ...validAddress, latitude: 10.7769 });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'longitude')).toBe(true);
  });

  it('rejects receiver coordinates outside geographic ranges', async () => {
    const dto = plainToInstance(QuoteAddressDto, {
      ...validAddress,
      latitude: 91,
      longitude: 181,
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['latitude', 'longitude']),
    );
  });
});
