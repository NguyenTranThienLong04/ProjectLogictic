export function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toLocalDateTimeInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${toLocalDateInputValue(date)}T${hours}:${minutes}`;
}

export function toIsoScheduleWindow(startValue: string, endValue: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (end.getTime() <= start.getTime()) return null;
  return { scheduledStartAt: start.toISOString(), scheduledEndAt: end.toISOString() };
}

export function scheduleDayRange(dateValue: string) {
  const start = new Date(`${dateValue}T00:00:00`);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { scheduledFrom: start.toISOString(), scheduledTo: end.toISOString() };
}
