import { formatClock, formatLast } from './formatMarket';

it('formats a clock time in local hours', () => {
  expect(formatClock(new Date(2026, 8, 22, 9, 5, 7).getTime())).toBe('09:05:07');
});

it('formats a BTCUSDT price to the tick and a size to the step', () => {
  expect(formatLast(86473.85, '0.01000000')).toBe('86,473.85');
  expect(formatLast(0.002, '0.00001000')).toBe('0.00200');
});
