export const vndFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

export const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatCurrency(amount: number): string {
  return vndFormatter.format(amount);
}

export function formatWeight(grams: number): string {
  if (grams >= 1000) {
    return `${(grams / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} kg`;
  }
  return `${grams.toLocaleString('vi-VN')} g`;
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return dateTimeFormatter.format(new Date(date));
}
