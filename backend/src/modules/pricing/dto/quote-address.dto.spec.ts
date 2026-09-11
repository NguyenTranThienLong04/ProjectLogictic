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
