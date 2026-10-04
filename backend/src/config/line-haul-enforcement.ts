/** Empty means compatibility mode. A cutover is an explicit, stable UTC instant. */
export function parseLineHaulEnforcementFrom(value: string | undefined): Date | null {
  const text = value?.trim();
  if (!text) return null;
  const date = new Date(text);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== (text.includes('.') ? text : text.replace('Z', '.000Z'))
  ) {
    throw new Error('LINE_HAUL_ENFORCEMENT_FROM must be an explicit UTC ISO timestamp or empty');
  }
  return date;
}
