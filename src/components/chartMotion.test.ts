import { cachedListReady, intervalMs, periodStart } from './chartMotion';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEDNESDAY = Date.parse('2026-09-23T15:04:30.000Z');
const MONDAY = Date.parse('2026-09-21T00:00:00.000Z');
const NEXT_MONDAY = Date.parse('2026-09-28T00:00:00.000Z');
const SEPTEMBER = Date.parse('2026-09-01T00:00:00.000Z');
const OCTOBER = Date.parse('2026-10-01T00:00:00.000Z');

it('keeps minute through day floors on the unix epoch', () => {
  expect(periodStart(WEDNESDAY, '1m')).toBe(Date.parse('2026-09-23T15:04:00.000Z'));
  expect(periodStart(WEDNESDAY, '15m')).toBe(Date.parse('2026-09-23T15:00:00.000Z'));
  expect(periodStart(WEDNESDAY, '1h')).toBe(Date.parse('2026-09-23T15:00:00.000Z'));
  expect(periodStart(WEDNESDAY, '4h')).toBe(Date.parse('2026-09-23T12:00:00.000Z'));
  expect(periodStart(WEDNESDAY, '1d')).toBe(Date.parse('2026-09-23T00:00:00.000Z'));
  expect(intervalMs('1w')).toBe(7 * DAY);
});

it('opens a week on Monday and a month on the 1st', () => {
  expect(periodStart(WEDNESDAY, '1w')).toBe(MONDAY);
  expect(periodStart(Date.parse('2026-09-27T23:59:00.000Z'), '1w')).toBe(MONDAY);
  expect(periodStart(NEXT_MONDAY, '1w')).toBe(NEXT_MONDAY);
  expect(periodStart(WEDNESDAY, '1M')).toBe(SEPTEMBER);
  expect(periodStart(Date.parse('2026-02-28T12:00:00.000Z'), '1M')).toBe(
    Date.parse('2026-02-01T00:00:00.000Z'),
  );
  expect(periodStart(OCTOBER, '1M')).toBe(OCTOBER);
});

it('treats the open Monday and the 1st as the current candle', () => {
  const meta = { expiresAt: OCTOBER + DAY };
  expect(cachedListReady(meta, [{ openTime: MONDAY }], Date.parse('2026-09-27T23:00:00.000Z'), '1w')).toBe(
    true,
  );
  expect(cachedListReady(meta, [{ openTime: MONDAY }], NEXT_MONDAY, '1w')).toBe(false);
  expect(cachedListReady(meta, [{ openTime: SEPTEMBER }], WEDNESDAY, '1M')).toBe(true);
  expect(cachedListReady(meta, [{ openTime: SEPTEMBER }], OCTOBER, '1M')).toBe(false);
});
