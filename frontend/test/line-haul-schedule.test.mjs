import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scheduleDayRange,
  toIsoScheduleWindow,
  toLocalDateInputValue,
  toLocalDateTimeInputValue,
} from '../src/features/line-haul/line-haul-schedule.ts';

test('normalizes a valid local schedule window to an exact ISO duration', () => {
  const window = toIsoScheduleWindow('2026-09-07T10:00', '2026-09-07T12:00');
  assert.ok(window);
  assert.equal(
    new Date(window.scheduledEndAt).getTime() - new Date(window.scheduledStartAt).getTime(),
    2 * 60 * 60 * 1_000,
  );
});

test('rejects zero-length, reversed, and malformed schedule input', () => {
  assert.equal(toIsoScheduleWindow('2026-09-07T10:00', '2026-09-07T10:00'), null);
  assert.equal(toIsoScheduleWindow('2026-09-07T12:00', '2026-09-07T10:00'), null);
  assert.equal(toIsoScheduleWindow('not-a-date', '2026-09-07T10:00'), null);
});

test('builds a local calendar-day range and round-trips input values', () => {
  const range = scheduleDayRange('2026-09-07');
  assert.ok(range);
  assert.equal(
    new Date(range.scheduledTo).getTime() - new Date(range.scheduledFrom).getTime(),
    24 * 60 * 60 * 1_000,
  );
  const date = new Date(2026, 8, 7, 10, 30);
  assert.equal(toLocalDateInputValue(date), '2026-09-07');
  assert.equal(toLocalDateTimeInputValue(date.toISOString()), '2026-09-07T10:30');
});
