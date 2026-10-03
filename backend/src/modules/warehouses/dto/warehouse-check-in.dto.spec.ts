import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PackageDto } from '../../shipments/dto/package.dto.js';
import { ShippingQuoteDto } from '../../pricing/dto/shipping-quote.dto.js';
import { WarehouseCheckInDto } from './warehouse-check-in.dto.js';
import type { PackageDimensionsDto } from '../../../common/dto/package-dimensions.dto.js';

describe('package dimensions across create, quote and warehouse check-in', () => {
  const dimensions = { lengthCm: 20, widthCm: 14.8, heightCm: 10 };
  const dimensionErrors = async (dto: object) =>
    (await validate(dto)).filter((error) =>
      ['lengthCm', 'widthCm', 'heightCm'].includes(error.property),
    );

  it.each([PackageDto, ShippingQuoteDto, WarehouseCheckInDto])(
    '%p accepts one decimal place',
    async (Dto) => {
      expect(
        await dimensionErrors(plainToInstance<PackageDimensionsDto, object>(Dto, dimensions)),
      ).toEqual([]);
    },
  );

  it.each([0, -1, 301, 300.1, 14.81, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid dimension %s everywhere',
    async (widthCm) => {
      for (const Dto of [PackageDto, ShippingQuoteDto, WarehouseCheckInDto]) {
        expect(
          await dimensionErrors(
            plainToInstance<PackageDimensionsDto, object>(Dto, { ...dimensions, widthCm }),
          ),
        ).toHaveLength(1);
      }
    },
  );

  it('keeps verified weight in integer grams', async () => {
    const errors = await validate(
      plainToInstance(WarehouseCheckInDto, {
        ...dimensions,
        packageVerified: true,
        actualWeightGrams: 1000.5,
      }),
    );
    expect(errors.some((error) => error.property === 'actualWeightGrams')).toBe(true);
  });
});
