import { useQuery, useSuspense } from '@data-client/react';
import { renderDataHook } from '@data-client/test';

import {
  Asset,
  AssetProfile,
  binanceHttps,
  getAssetProfile,
  getAssets,
} from './Asset';

const HOUR = 60 * 60 * 1000;

const sol = {
  assetCode: 'SOL',
  assetName: 'Solana',
  tags: ['Layer1_Layer2', 'pos', 'mining-zone', 'Solana'],
  delisted: false,
  preDelist: false,
  pdTradeDeadline: null,
  pdAnnounceUrl: null,
  oldAssetCode: '',
  newAssetCode: '',
  swapAnnounceUrl: '',
  logoUrl: 'https://example.test/sol.png',
};

const announce = 'https://www.binance.com/en/support/announcement/detail/example';
const aweUrl =
  'https://www.binance.com/en/support/announcement/detail/ad0f6c6b7d6640eea285538c96e2cd42 (https://www.binance.com/en/support/announcement/detail/ad0f6c6b7d6640eea285538c96e2cd42';

function asset(fields: Record<string, unknown>) {
  return { ...sol, pdAnnounceUrl: null, swapAnnounceUrl: '', oldAssetCode: '', newAssetCode: '', ...fields };
}

function useAsset(code: string) {
  useSuspense(getAssets);
  return useQuery(Asset, { assetCode: code });
}

function read(code: string, row: Record<string, unknown>) {
  const { result } = renderDataHook(() => useAsset(code), {
    initialFixtures: [
      {
        endpoint: getAssets,
        args: [],
        response: { success: true, code: '000000', data: [asset({ assetCode: code, ...row })] },
      },
    ],
  });
  const found = result.current;
  if (!found) throw new Error(`missing ${code}`);
  return found;
}

it('keeps an hour and the last read', () => {
  expect(getAssets.dataExpiryLength).toBe(HOUR);
  expect(getAssetProfile.dataExpiryLength).toBe(HOUR);
  expect(getAssets.errorPolicy?.(new TypeError('Failed to fetch'))).toBe('soft');
  expect(getAssetProfile.errorPolicy?.({ status: 400 })).toBe('soft');
});

it('stores the deadline as milliseconds and reads a Date', () => {
  const usdp = read('USDP', {
    assetName: 'Pax Dollar',
    tags: ['stablecoin'],
    preDelist: true,
    pdTradeDeadline: 1790218800000,
    pdAnnounceUrl: announce,
  });
  expect(usdp.pdTradeDeadline?.toISOString()).toBe('2026-09-24T03:00:00.000Z');
  expect(usdp.caution?.kind).toBe('preDelist');
  expect(usdp.caution?.deadline?.toISOString()).toBe('2026-09-24T03:00:00.000Z');
  expect(Asset.schema.pdTradeDeadline(1790218800000).toISOString()).toBe('2026-09-24T03:00:00.000Z');
});

it('keeps raw fields, including ones this screen does not read', () => {
  const { controller } = renderDataHook(() => useAsset('SOL'), {
    initialFixtures: [
      { endpoint: getAssets, args: [], response: { success: true, data: [sol] } },
      {
        endpoint: getAssetProfile,
        args: [{ symbol: 'SOL' }],
        response: {
          success: true,
          data: { alias: 'SOL', al: announce, rsu: null, ws: 'https://solana.com' },
        },
      },
    ],
  });
  const stored = controller.getState().entities.Asset?.SOL as { pdTradeDeadline?: unknown; logoUrl?: string };
  expect(stored.logoUrl).toBe('https://example.test/sol.png');
  expect(stored.pdTradeDeadline).toBeNull();
  const profile = controller.getState().entities.AssetProfile?.SOL as { ws?: string; al?: string };
  expect(profile.al).toBe(announce);
  expect(profile.ws).toBe('https://solana.com');
});

it('treats an empty rename and a self-code as no rename', () => {
  const found = read('SOL', {});
  expect(found.kinds).toEqual(['Layer 1 / Layer 2', 'Proof of stake']);
  expect(found.renamedFrom).toBeUndefined();
  expect(found.renamedTo).toBeUndefined();
  expect(found.caution).toBeUndefined();
});

it('hides tags that are not on the allowlist and leaves the caption empty', () => {
  const found = read('FIL', { assetName: 'Filecoin', tags: ['storage-zone'] });
  expect(found.kinds).toEqual([]);
  expect(found.caution).toBeUndefined();
});

it('puts a leading kind ahead of Binance tag order and stops at two', () => {
  const found = read('TSLAB', { assetName: 'Tesla (bStocks)', tags: ['pos', 'bStocks', 'AI'] });
  expect(found.kinds).toEqual(['Tokenized stock', 'Proof of stake']);
});

it('prefers Monitoring over a rename from', () => {
  const found = read('HEI', {
    assetName: 'Heima',
    tags: ['Monitoring', 'Seed', 'defi'],
    oldAssetCode: 'LIT',
    newAssetCode: 'HEI',
    swapAnnounceUrl: announce,
  });
  expect(found.renamedFrom).toBe('LIT');
  expect(found.renamedTo).toBeUndefined();
  expect(found.caution?.kind).toBe('monitoring');
  expect(found.caution?.link).toBeUndefined();
});

it('reads renamed-to before delisted, and ignores a self old code', () => {
  const found = read('KLAY', {
    assetName: 'Kaia',
    delisted: true,
    oldAssetCode: 'KLAY',
    newAssetCode: 'KAIA',
    swapAnnounceUrl: announce,
    pdAnnounceUrl: announce,
  });
  expect(found.caution).toMatchObject({ kind: 'renamedTo', code: 'KAIA', link: announce });
});

it('reads renamed-from when nothing riskier matches', () => {
  const found = read('KAIA', {
    assetName: 'Kaia',
    tags: ['Layer1_Layer2'],
    oldAssetCode: 'KLAY',
    newAssetCode: 'KAIA',
    swapAnnounceUrl: announce,
  });
  expect(found.caution).toMatchObject({ kind: 'renamedFrom', code: 'KLAY', link: announce });
  expect(found.kinds).toEqual(['Layer 1 / Layer 2']);
});

it('marks a passed pre-delist deadline as delisted and keeps the link', () => {
  const found = read('SCRT', {
    assetName: 'Secret',
    preDelist: true,
    delisted: true,
    pdTradeDeadline: 1788404400000,
    pdAnnounceUrl: announce,
  });
  expect(found.caution?.kind).toBe('preDelist');
  expect(found.caution?.deadline?.toISOString()).toBe('2026-09-03T03:00:00.000Z');
  expect(found.caution?.link).toBe(announce);
});

it('shows Seed when no earlier rule matches', () => {
  const found = read('0G', { assetName: '0G', tags: ['Layer1_Layer2', 'Seed', 'HODLer', 'AI'] });
  expect(found.kinds).toEqual(['Layer 1 / Layer 2', 'AI']);
  expect(found.caution?.kind).toBe('seed');
});

it('falls back to the code when the name is empty', () => {
  expect(read('ABC', { assetName: '' }).name).toBe('ABC');
});

it('rejects a foreign host and a url that contains whitespace', () => {
  expect(binanceHttps('https://example.com/announcement')).toBeUndefined();
  expect(binanceHttps(aweUrl)).toBeUndefined();
  expect(binanceHttps(announce)).toBe(announce);
  const foreign = read('DNT', {
    assetName: 'district0x',
    delisted: true,
    pdAnnounceUrl: 'https://example.com/delist',
    oldAssetCode: null,
    newAssetCode: null,
  });
  expect(foreign.caution).toMatchObject({ kind: 'delisted', link: undefined });
  const dirty = read('AWE', {
    assetName: 'AWE Network',
    tags: [],
    oldAssetCode: 'STPT',
    newAssetCode: 'AWE',
    swapAnnounceUrl: aweUrl,
  });
  expect(dirty.caution).toMatchObject({ kind: 'renamedFrom', code: 'STPT', link: undefined });
});

it('treats token-info data null as no profile and a bad envelope as an error', () => {
  const { result } = renderDataHook(
    () => useSuspense(getAssetProfile, { symbol: 'EUR' }),
    {
      initialFixtures: [
        {
          endpoint: getAssetProfile,
          args: [{ symbol: 'EUR' }],
          response: { success: true, data: null },
        },
      ],
    },
  );
  expect(result.current.data).toBeNull();
  expect(() => getAssetProfile.process({ success: true, data: 'nope' }, { symbol: 'EUR' })).toThrow(
    'Invalid token info',
  );
  expect(() => getAssetProfile.process({ success: false, data: null }, { symbol: 'EUR' })).toThrow(
    'Invalid token info',
  );
  expect(getAssetProfile.process({ success: true, data: null }, { symbol: 'EUR' })).toEqual({
    data: null,
  });
  expect(() => getAssets.process({ success: false, data: [] })).toThrow('Invalid asset list');
  expect(() => getAssets.process({ success: true, data: {} })).toThrow('Invalid asset list');
});

it('does not turn a missing profile into an empty asset list', () => {
  const { result } = renderDataHook(() => useAsset('BCC'), {
    initialFixtures: [
      { endpoint: getAssets, args: [], response: { success: true, data: [sol] } },
    ],
  });
  expect(result.current).toBeUndefined();
});

it('builds the profile url through tokenInfoUrl', () => {
  expect(getAssetProfile.url({ symbol: 'SOL' })).toBe(
    'https://www.binance.com/bapi/apex/v1/friendly/apex/marketing/web/token-info?symbol=SOL',
  );
  const { result } = renderDataHook(
    () => useSuspense(getAssetProfile, { symbol: 'SOL' }),
    {
      initialFixtures: [
        {
          endpoint: getAssetProfile,
          args: [{ symbol: 'SOL' }],
          response: {
            success: true,
            data: {
              alias: 'SOL',
              al: 'https://www.binance.com/en/academy/articles/what-is-solana-sol',
              rsu: 'https://evil.example/research',
            },
          },
        },
      ],
    },
  );
  const profile = result.current.data as AssetProfile;
  expect(profile.academyUrl).toContain('/academy/');
  expect(profile.researchUrl).toBeUndefined();
});
