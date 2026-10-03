import { z } from 'zod';

export function dimensionSchema(label: string) {
  return z.number({ error: `${label} phải là số hợp lệ` })
    .min(1, `${label} phải từ 1 đến 300 cm`)
    .max(300, `${label} phải từ 1 đến 300 cm`)
    .refine((value) => Number(value.toFixed(1)) === value, `${label} chỉ được có tối đa 1 chữ số thập phân`);
}

export const packageDimensionSchemas = {
  lengthCm: dimensionSchema('Dài (cm)'),
  widthCm: dimensionSchema('Rộng (cm)'),
  heightCm: dimensionSchema('Cao (cm)'),
};

export function dimensionInputError(field: keyof typeof packageDimensionSchemas, value: string) {
  const result = packageDimensionSchemas[field].safeParse(value.trim() ? Number(value) : NaN);
  return result.success ? undefined : result.error.issues[0].message;
}
