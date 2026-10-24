import {
  decimalsOf,
  formatCandleTime,
  formatClock,
  formatPrice,
  formatSize,
  trimDecimal,
} from './formatMarket';

it('formats prices at the tick and sizes at the step', () => {
  expect(formatPrice(86507.05, 2)).toBe('86,507.05');
  expect(formatPrice(86473.85, 2)).toBe('86,473.85');
  expect(formatPrice(0.0995, 5)).toBe('0.09950');
  expect(formatPrice(0.00000601, 8)).toBe('0.00000601');
  expect(formatSize(28058, 0)).toBe('28058');
  expect(formatSize(0.002, 5)).toBe('0.00200');
});

it('trims decimal strings without a float', () => {
  expect(trimDecimal('0.01000000')).toBe('0.01');
  expect(trimDecimal('5.00000000')).toBe('5');
  expect(trimDecimal('1.00')).toBe('1');
  expect(trimDecimal('')).toBe('');
});

it('cleans float noise and scientific decimals', () => {
  expect(decimalsOf(86412.38999999)).toBe(2);
  expect(decimalsOf(1e-7)).toBe(7);
});

it('formats a clock time in local hours', () => {
  expect(formatClock(new Date(2026, 8, 22, 9, 5, 7).getTime())).toBe('09:05:07');
});

it('formats a candle open in the phone zone', () => {
  const now = new Date(2026, 8, 23, 15, 4).getTime();
  const same = new Date(2026, 8, 23, 14, 30).getTime();
  const older = new Date(2026, 8, 22, 9, 5).getTime();
  const lastYear = new Date(2025, 11, 31, 23, 0).getTime();
  expect(formatCandleTime(same, '15m', now)).toBe('14:30');
  expect(formatCandleTime(older, '1h', now)).toBe('22 Sep, 09:05');
  expect(formatCandleTime(same, '1d', now)).toBe('23 Sep');
  expect(formatCandleTime(lastYear, '1w', now)).toBe('31 Dec 2025');
  expect(formatCandleTime(lastYear, '4h', now)).toBe('31 Dec 2025, 23:00');
});
