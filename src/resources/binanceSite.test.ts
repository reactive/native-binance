import { Platform } from 'react-native';

import { tokenInfoTarget } from '../../binanceDevProxy';
import { DEV_PREFIX, TOKEN_INFO_PATH } from './binanceSitePaths';
import { tokenInfoUrl } from './binanceSite';

const SOL = `${TOKEN_INFO_PATH}?symbol=SOL`;

function withOs(os: string, run: () => void) {
  const prior = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  try {
    run();
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: prior });
  }
}

it('calls www.binance.com directly on native', () => {
  expect(tokenInfoUrl('SOL')).toBe(`https://www.binance.com${SOL}`);
  expect(tokenInfoUrl('SOL')).not.toContain(DEV_PREFIX);
});

it('uses the dev proxy on web and the host in a release web build', () => {
  const dev = __DEV__;
  try {
    withOs('web', () => {
      expect(tokenInfoUrl('SOL')).toBe(`${DEV_PREFIX}${SOL}`);
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
      expect(tokenInfoUrl('SOL')).toBe(`https://www.binance.com${SOL}`);
    });
  } finally {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
  }
});

it('proxies only the token-info path', () => {
  expect(tokenInfoTarget(`${DEV_PREFIX}${SOL}`)?.href).toBe(`https://www.binance.com${SOL}`);
  expect(tokenInfoTarget(`${DEV_PREFIX}/bapi/asset/v2/public/asset/asset/get-all-asset`)).toBeNull();
  expect(tokenInfoTarget(`${DEV_PREFIX}${TOKEN_INFO_PATH}?symbol=../etc`)).toBeNull();
  expect(tokenInfoTarget(`${DEV_PREFIX}${TOKEN_INFO_PATH}?symbol=SOL&next=/admin`)?.search).toBe(
    '?symbol=SOL',
  );
  expect(tokenInfoTarget(`https://www.binance.com${SOL}`)).toBeNull();
});
