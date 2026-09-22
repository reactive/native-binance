import { decimalsOf, formatPrice, formatSize, trimDecimal } from './formatMarket';

it('formats prices at the tick and sizes at the step', () => {
  expect(formatPrice(86507.05, 2)).toBe('86,507.05');
  expect(formatPrice(0.0995, 5)).toBe('0.09950');
  expect(formatPrice(0.00000601, 8)).toBe('0.00000601');
  expect(formatSize(28058, 0)).toBe('28058');
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
