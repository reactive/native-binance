import { Platform } from 'react-native';

import { DEV_PREFIX, SITE, TOKEN_INFO_PATH } from './binanceSitePaths';

const paths: { DEV_PREFIX: string; SITE: string; TOKEN_INFO_PATH: string } = {
  DEV_PREFIX,
  SITE,
  TOKEN_INFO_PATH,
};

/** Academy and project links. Native calls www.binance.com. Web dev uses the Metro proxy. */
export function tokenInfoUrl(symbol: string): string {
  const path = `${paths.TOKEN_INFO_PATH}?symbol=${encodeURIComponent(symbol)}`;
  if (__DEV__ && Platform.OS === 'web') return `${paths.DEV_PREFIX}${path}`;
  return `${paths.SITE}${path}`;
}
