jest.mock('@reactive/silk-native', () => {
  const React = require('react');
  const { Text: RNText, View } = require('react-native');
  return {
    SilkProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => ({
      theme: { semantic: { color: { borderSubtle: '#d9d9d9' } } },
    }),
    Text: ({
      children,
      role: _role,
      tone: _tone,
      ...rest
    }: {
      children?: React.ReactNode;
      role?: string;
      tone?: string;
    }) => React.createElement(RNText, rest, children),
    Badge: ({ children, ...rest }: { children?: React.ReactNode }) =>
      React.createElement(View, rest, React.createElement(RNText, null, children)),
    Skeleton: (props: object) => React.createElement(View, props),
  };
});

import { actionTypes, AsyncBoundary, DataProvider, getDefaultManagers } from '@data-client/react';
import type { Manager } from '@data-client/react';
import { mockInitialState, MockResolver } from '@data-client/test';
import { SilkProvider } from '@reactive/silk-native';
import { Platform, StyleSheet } from 'react-native';
import TestRenderer, { type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { formatDeadline } from '@/components/formatDeadline';
import { InstrumentInfo } from '@/components/InstrumentInfo';
import { getAssetProfile, getAssets } from '@/resources/Asset';
import { getExchangeInfo } from '@/resources/Symbol';

const { act } = TestRenderer;

const NOW = Date.parse('2026-09-23T15:00:00.000Z');
const ANNOUNCE = 'https://www.binance.com/en/support/announcement/detail/example';
const AWE_URL =
  'https://www.binance.com/en/support/announcement/detail/ad0f6c6b7d6640eea285538c96e2cd42 (https://www.binance.com/en/support/announcement/detail/ad0f6c6b7d6640eea285538c96e2cd42';
const ACADEMY = 'https://www.binance.com/en/academy/articles/what-is-solana-sol';
const RESEARCH = 'https://www.binance.com/en/research/projects/solana';
const SOL_PAPER = 'https://solana.com/solana-whitepaper.pdf';
const MARKET = { mc: '918273645', rk: 4, v: '222', cs: '111', ath: '333', fdmc: '444' };

const ROW_IDS = [
  'info-status',
  'info-base',
  'info-quote',
  'info-tick',
  'info-step',
  'info-min-notional',
];

type Fixture = {
  endpoint: typeof getExchangeInfo | typeof getAssets | typeof getAssetProfile;
  args: unknown[];
  response: unknown;
  error?: boolean;
  delay?: number;
};

function pair(symbol: string, base: string, status = 'TRADING') {
  return {
    symbol,
    status,
    baseAsset: base,
    quoteAsset: 'USDT',
    filters: [
      { filterType: 'PRICE_FILTER', tickSize: '0.01000000' },
      { filterType: 'LOT_SIZE', stepSize: '0.01000000' },
      { filterType: 'NOTIONAL', minNotional: '5.00000000' },
    ],
  };
}

function asset(fields: Record<string, unknown>) {
  return {
    assetCode: 'SOL',
    assetName: 'Solana',
    tags: [] as string[],
    delisted: false,
    preDelist: false,
    pdTradeDeadline: null,
    pdAnnounceUrl: null,
    oldAssetCode: '',
    newAssetCode: '',
    swapAnnounceUrl: '',
    ...fields,
  };
}

function profile(symbol: string, data: unknown): Fixture {
  return {
    endpoint: getAssetProfile,
    args: [{ symbol }],
    response: { success: true, data },
  };
}

function screenFixtures(
  symbol: string,
  base: string,
  row: Record<string, unknown>,
  data: unknown,
  status = 'TRADING',
): Fixture[] {
  return [
    {
      endpoint: getExchangeInfo,
      args: [],
      response: { symbols: [pair(symbol, base, status)] },
    },
    {
      endpoint: getAssets,
      args: [],
      response: { success: true, data: [asset({ assetCode: base, ...row })] },
    },
    profile(base, data),
  ];
}

let tree: ReactTestRenderer | undefined;

function unmount() {
  if (!tree) return;
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
}

afterEach(() => {
  unmount();
  jest.restoreAllMocks();
});

function mount(symbol: string, fixtures: Fixture[], managers?: Manager[]) {
  act(() => {
    tree = TestRenderer.create(
      <DataProvider
        initialState={mockInitialState(fixtures)}
        {...(managers ? { managers } : {})}
      >
        <SilkProvider>
          <AsyncBoundary fallback={null}>
            <InstrumentInfo symbol={symbol} />
          </AsyncBoundary>
        </SilkProvider>
      </DataProvider>,
    );
  });
  if (!tree) throw new Error('renderer missing');
  return tree;
}

async function mountLive(
  symbol: string,
  fixtures: Fixture[],
  managers?: Manager[],
  initialState?: ReturnType<typeof mockInitialState>,
) {
  await act(async () => {
    tree = TestRenderer.create(
      <DataProvider
        {...(initialState ? { initialState } : {})}
        {...(managers ? { managers } : {})}
      >
        <MockResolver fixtures={fixtures}>
          <SilkProvider>
            <AsyncBoundary fallback={null}>
              <InstrumentInfo symbol={symbol} />
            </AsyncBoundary>
          </SilkProvider>
        </MockResolver>
      </DataProvider>,
    );
  });
  if (!tree) throw new Error('renderer missing');
  return tree;
}

function matches(testID: string): ReactTestInstance[] {
  return tree?.root.findAll(item => item.props.testID === testID) ?? [];
}

/** Function components repeat the id. The view that owns layout is the one with a style. */
function node(testID: string): ReactTestInstance | undefined {
  const found = matches(testID);
  return found.find(item => item.props.style != null) ?? found[0];
}

function textOf(testID: string): string {
  const found = node(testID);
  if (!found) return '';
  const parts: string[] = [];
  const walk = (item: ReactTestInstance) => {
    for (const child of item.children) {
      if (typeof child === 'string') parts.push(child);
      else walk(child);
    }
  };
  walk(found);
  return parts.join(' ');
}

function flat(testID: string) {
  const found = node(testID);
  if (!found) throw new Error(`missing ${testID}`);
  return StyleSheet.flatten(found.props.style);
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

it('keeps the instrument rows first for SOL and shows both reads', () => {
  mount(
    'SOLUSDT',
    screenFixtures('SOLUSDT', 'SOL', {
      assetName: 'Solana',
      tags: ['Layer1_Layer2', 'pos', 'mining-zone', 'Solana'],
    }, { alias: 'SOL', al: ACADEMY, rsu: RESEARCH, wpu: SOL_PAPER, ...MARKET }),
  );
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of tree?.root.findAll(item => item.props.style != null && item.props.testID) ?? []) {
    const id = item.props.testID as string;
    if (seen.has(id) || (!ROW_IDS.includes(id) && id !== 'asset-header')) continue;
    seen.add(id);
    ids.push(id);
  }
  expect(ids).toEqual([...ROW_IDS, 'asset-header']);
  expect(textOf('info-status')).toContain('TRADING');
  expect(textOf('info-base')).toContain('SOL');
  expect(textOf('info-tick')).toContain('0.01');
  expect(node('asset-header')?.props.accessibilityLabel).toBe(
    'Solana, Layer 1 / Layer 2, Proof of stake',
  );
  expect(node('asset-caution')).toBeUndefined();
  expect(textOf('asset-academy')).toBe('What is Solana? Binance Academy');
  expect(node('asset-academy')?.props.accessibilityHint).toBe('Opens in the browser');
  expect(node('asset-academy')?.props.accessibilityLabel).toBe('What is Solana?, Binance Academy');
  expect(textOf('asset-concept-1')).toBe('Layer 1 vs layer 2 Binance Academy');
  expect(textOf('asset-concept-2')).toBe('Proof of stake explained Binance Academy');
  expect(node('asset-concept-2')?.props.accessibilityLabel).toBe(
    'Proof of stake explained, Binance Academy',
  );
  expect(textOf('asset-research')).toBe('Solana research Binance Research');
  expect(textOf('asset-whitepaper')).toBe('Solana whitepaper solana.com');
  expect(flat('asset-academy').borderTopWidth).toBeUndefined();
  expect(flat('asset-concept-1').borderTopWidth).toBe(StyleSheet.hairlineWidth);
  expect(flat('asset-research').borderTopWidth).toBe(StyleSheet.hairlineWidth);
  expect(flat('asset-whitepaper').borderTopWidth).toBe(StyleSheet.hairlineWidth);
  expect(flat('asset-header').paddingTop).toBeCloseTo(9.1);
  expect(flat('asset-header').height).toBe(56);
  expect(flat('asset-gap').height).toBe(20);
  expect(flat('asset-academy').height).toBe(48);
  const body =
    6 * 48 +
    flat('asset-gap').height +
    flat('asset-header').height +
    5 * flat('asset-whitepaper').height;
  expect(body).toBe(604);
  expect(JSON.stringify(tree?.toJSON())).not.toContain('918273645');
  expect(JSON.stringify(tree?.toJSON())).not.toContain('↗');
});

it('shows Seed and both reads for 0G, with a hairline under the caution', () => {
  mount(
    '0GUSDT',
    screenFixtures('0GUSDT', '0G', {
      assetName: '0G',
      tags: ['Layer1_Layer2', 'Seed', 'HODLer', 'AI'],
    }, {
      alias: '0G',
      al: 'https://www.binance.com/en/academy/articles/what-is-0g-0g',
      rsu: 'https://www.binance.com/en/research/projects/0g',
      wpu: 'https://cdn.jsdelivr.net/gh/0glabs/0g-doc/static/whitepaper.pdf',
      ...MARKET,
    }),
  );
  expect(textOf('asset-caution')).toContain('Newer project');
  expect(textOf('asset-caution-badge')).toBe('Seed');
  expect(node('asset-caution')?.props.onPress).toBeUndefined();
  expect(node('asset-caution')?.props.accessibilityLabel).toBe(
    'Seed. Newer project. May have higher volatility and risk.',
  );
  expect(flat('asset-academy').borderTopWidth).toBe(StyleSheet.hairlineWidth);
  expect(textOf('asset-kinds')).toBe('Layer 1 / Layer 2, AI');
  expect(textOf('asset-academy')).toBe('What is 0G? Binance Academy');
  expect(textOf('asset-concept-1')).toBe('Layer 1 vs layer 2 Binance Academy');
  expect(node('asset-concept-2')).toBeUndefined();
  expect(textOf('asset-research')).toBe('0G research Binance Research');
  expect(textOf('asset-whitepaper')).toBe('0G whitepaper cdn.jsdelivr.net');
  expect(JSON.stringify(tree?.toJSON())).not.toContain('Blockchain and AI');
  expect(JSON.stringify(tree?.toJSON())).not.toContain('918273645');
});

it('leaves FIL line 2 blank without moving the name after the load', async () => {
  const fixtures: Fixture[] = [
    {
      endpoint: getExchangeInfo,
      args: [],
      response: { symbols: [pair('FILUSDT', 'FIL')] },
    },
    {
      endpoint: getAssets,
      args: [],
      delay: 200,
      response: {
        success: true,
        data: [asset({ assetCode: 'FIL', assetName: 'Filecoin', tags: ['storage-zone'] })],
      },
    },
    profile('FIL', { alias: 'FIL', al: ACADEMY, rsu: RESEARCH }),
  ];
  await mountLive('FILUSDT', fixtures);
  expect(textOf('asset-name')).toBe('FIL');
  expect(node('asset-kinds-loading')).toBeDefined();
  expect(flat('asset-header').paddingTop).toBeCloseTo(9.1);
  expect(flat('asset-kinds').height).toBeCloseTo(16.2);
  const before = flat('info-status');

  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
  });

  expect(textOf('asset-name')).toBe('Filecoin');
  expect(textOf('asset-kinds')).toBe('');
  expect(node('asset-kinds-loading')).toBeUndefined();
  expect(flat('asset-header').paddingTop).toBeCloseTo(9.1);
  expect(flat('asset-kinds').height).toBeCloseTo(16.2);
  expect(flat('info-status').height).toBe(48);
  expect(before.height).toBe(48);
  expect(node('asset-caution')).toBeUndefined();
});

it('shows a future USDP deadline in 24-hour local time and only Research', () => {
  mount(
    'USDPUSDT',
    screenFixtures('USDPUSDT', 'USDP', {
      assetName: 'Pax Dollar',
      tags: ['stablecoin'],
      preDelist: true,
      pdTradeDeadline: 1790218800000,
      pdAnnounceUrl: ANNOUNCE,
    }, { alias: 'USDP', al: null, rsu: RESEARCH }),
  );
  const usdp = formatDeadline(new Date(1790218800000), NOW);
  expect(usdp.future).toBe(true);
  expect(textOf('asset-caution')).toContain(`Trading ends ${usdp.when}`);
  expect(textOf('asset-caution-badge')).toBe('Delisting');
  expect(node('asset-caution')?.props.accessibilityRole).toBe('link');
  expect(node('asset-academy')).toBeUndefined();
  expect(textOf('asset-concept-1')).toBe('What is a stablecoin? Binance Academy');
  expect(textOf('asset-research')).toContain('Pax Dollar research');
});

it('shows a passed SCRT deadline as Delisted', () => {
  mount(
    'SCRTUSDT',
    screenFixtures('SCRTUSDT', 'SCRT', {
      assetName: 'Secret',
      tags: ['Monitoring'],
      delisted: true,
      preDelist: true,
      pdTradeDeadline: 1788404400000,
      pdAnnounceUrl: ANNOUNCE,
    }, null, 'BREAK'),
  );
  expect(textOf('asset-caution-badge')).toBe('Delisted');
  const scrt = formatDeadline(new Date(1788404400000), NOW);
  expect(scrt.future).toBe(false);
  expect(textOf('asset-caution')).toContain(`Trading ended ${scrt.when}`);
  expect(textOf('info-status')).toContain('BREAK');
});

it('shows Monitoring for HEI instead of the rename', () => {
  mount(
    'HEIUSDT',
    screenFixtures('HEIUSDT', 'HEI', {
      assetName: 'Heima',
      tags: ['Monitoring', 'Seed'],
      oldAssetCode: 'LIT',
      newAssetCode: 'HEI',
      swapAnnounceUrl: ANNOUNCE,
    }, { alias: 'HEI', al: null, rsu: null }),
  );
  expect(textOf('asset-caution-badge')).toBe('Monitoring');
  expect(textOf('asset-caution')).toContain('Binance may delist it');
  expect(textOf('asset-caution')).not.toContain('LIT');
  expect(node('asset-academy')).toBeUndefined();
});

it('shows KAIA renamed from KLAY with no read rows', () => {
  mount(
    'KAIAUSDT',
    screenFixtures('KAIAUSDT', 'KAIA', {
      assetName: 'Kaia',
      tags: ['Layer1_Layer2'],
      oldAssetCode: 'KLAY',
      newAssetCode: 'KAIA',
      swapAnnounceUrl: ANNOUNCE,
    }, { alias: 'KAIA', al: null, rsu: null }),
  );
  expect(textOf('asset-caution')).toContain('Renamed from KLAY');
  expect(node('asset-caution')?.props.onPress).toEqual(expect.any(Function));
  expect(node('asset-academy')).toBeUndefined();
  expect(node('asset-research')).toBeUndefined();
  expect(textOf('asset-concept-1')).toBe('Layer 1 vs layer 2 Binance Academy');
});

it('shows KLAY now trading as KAIA', () => {
  mount(
    'KLAYUSDT',
    screenFixtures(
      'KLAYUSDT',
      'KLAY',
      {
        assetName: 'Kaia',
        delisted: true,
        oldAssetCode: 'KLAY',
        newAssetCode: 'KAIA',
        swapAnnounceUrl: ANNOUNCE,
        pdAnnounceUrl: ANNOUNCE,
      },
      null,
      'BREAK',
    ),
  );
  expect(textOf('asset-caution')).toContain('Now trades as KAIA');
  expect(textOf('asset-caution-badge')).toBe('Renamed');
});

it('shows TSLAB as a tokenized stock with no read rows', () => {
  mount(
    'TSLABUSDT',
    screenFixtures('TSLABUSDT', 'TSLAB', {
      assetName: 'Tesla (bStocks)',
      tags: ['bStocks'],
    }, { alias: 'TSLAB', al: null, rsu: null }),
  );
  expect(textOf('asset-kinds')).toBe('Tokenized stock');
  expect(node('asset-caution')).toBeUndefined();
  expect(node('asset-academy')).toBeUndefined();
  expect(textOf('asset-concept-1')).toBe('What are bStocks? Binance Academy');
  expect(node('asset-research')).toBeUndefined();
  expect(node('asset-whitepaper')).toBeUndefined();
});

it('links a delisted asset only when the announcement is on Binance', () => {
  mount(
    'OMGUSDT',
    screenFixtures(
      'OMGUSDT',
      'OMG',
      {
        assetName: 'OMG Network',
        delisted: true,
        pdAnnounceUrl: ANNOUNCE,
        oldAssetCode: null,
        newAssetCode: null,
      },
      null,
      'BREAK',
    ),
  );
  expect(textOf('asset-caution')).toContain('Binance delisted OMG');
  expect(textOf('asset-caution')).toContain('Binance announcement');
  expect(node('asset-caution')?.props.onPress).toEqual(expect.any(Function));

  unmount();
  mount(
    'DNTUSDT',
    screenFixtures(
      'DNTUSDT',
      'DNT',
      {
        assetName: 'district0x',
        tags: [],
        delisted: true,
        pdAnnounceUrl: null,
        oldAssetCode: null,
        newAssetCode: null,
      },
      null,
      'BREAK',
    ),
  );
  expect(textOf('asset-caution')).toContain('Binance delisted DNT');
  expect(textOf('asset-caution')).not.toContain('announcement');
  expect(node('asset-caution')?.props.onPress).toBeUndefined();
});

it('does not press a foreign host or a url that contains whitespace', () => {
  mount(
    'DNTUSDT',
    screenFixtures(
      'DNTUSDT',
      'DNT',
      {
        assetName: 'district0x',
        delisted: true,
        pdAnnounceUrl: 'https://example.com/delist',
        oldAssetCode: null,
        newAssetCode: null,
      },
      null,
      'BREAK',
    ),
  );
  expect(node('asset-caution')?.props.onPress).toBeUndefined();
  expect(textOf('asset-caution')).not.toContain('announcement');

  unmount();
  mount(
    'AWEUSDT',
    screenFixtures('AWEUSDT', 'AWE', {
      assetName: 'AWE Network',
      tags: [],
      oldAssetCode: 'STPT',
      newAssetCode: 'AWE',
      swapAnnounceUrl: AWE_URL,
    }, { alias: 'AWE', al: 'https://example.com/academy', rsu: null }),
  );
  expect(node('asset-caution')?.props.onPress).toBeUndefined();
  expect(textOf('asset-caution')).not.toContain('announcement');
  expect(node('asset-academy')).toBeUndefined();
});

it('says when a break pair has no asset record', () => {
  mount('BCCUSDT', [
    {
      endpoint: getExchangeInfo,
      args: [],
      response: { symbols: [pair('BCCUSDT', 'BCC', 'BREAK')] },
    },
    { endpoint: getAssets, args: [], response: { success: true, data: [asset({})] } },
    profile('BCC', null),
  ]);
  expect(textOf('info-base')).toContain('BCC');
  expect(textOf('asset-header')).toContain('No asset details for BCC');
  expect(node('asset-caution')).toBeUndefined();
  expect(node('info-missing')).toBeUndefined();
});

it('keeps the instrument rows when the asset read fails', async () => {
  await mountLive('SOLUSDT', [
    {
      endpoint: getExchangeInfo,
      args: [],
      response: { symbols: [pair('SOLUSDT', 'SOL')] },
    },
    {
      endpoint: getAssets,
      args: [],
      response: new TypeError('Failed to fetch'),
      error: true,
    },
    profile('SOL', { alias: 'SOL', al: ACADEMY, rsu: RESEARCH }),
  ]);
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  expect(ROW_IDS.every(id => node(id))).toBe(true);
  expect(textOf('asset-header')).toContain('Couldn’t load asset details');
  expect(node('load-error')).toBeUndefined();
  expect(node('asset-academy')).toBeUndefined();
});

it('keeps the header and caution when token-info fails', async () => {
  await mountLive('0GUSDT', [
    {
      endpoint: getExchangeInfo,
      args: [],
      response: { symbols: [pair('0GUSDT', '0G')] },
    },
    {
      endpoint: getAssets,
      args: [],
      response: {
        success: true,
        data: [asset({ assetCode: '0G', assetName: '0G', tags: ['Seed'] })],
      },
    },
    {
      endpoint: getAssetProfile,
      args: [{ symbol: '0G' }],
      response: new TypeError('Failed to fetch'),
      error: true,
    },
  ]);
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  expect(textOf('asset-name')).toBe('0G');
  expect(textOf('asset-caution-badge')).toBe('Seed');
  expect(node('asset-academy')).toBeUndefined();
  expect(node('load-error')).toBeUndefined();
  expect(node('asset-concept-1')).toBeUndefined();
});

it('renders no read rows when token-info data is null', () => {
  mount(
    'EURUSDT',
    screenFixtures('EURUSDT', 'EUR', { assetName: 'Euro', tags: [] }, null),
  );
  expect(textOf('asset-name')).toBe('Euro');
  expect(textOf('asset-kinds')).toBe('');
  expect(node('asset-academy')).toBeUndefined();
  expect(node('asset-research')).toBeUndefined();
});

it('starts token-info before get-all-asset resolves', async () => {
  const calls: string[] = [];
  const spy: Manager = {
    middleware: () => next => async action => {
      if (action.type === actionTypes.FETCH && typeof action.key === 'string') calls.push(action.key);
      return next(action);
    },
    cleanup() {},
  };
  await mountLive(
    'SOLUSDT',
    [
      {
        endpoint: getExchangeInfo,
        args: [],
        response: { symbols: [pair('SOLUSDT', 'SOL')] },
      },
      {
        endpoint: getAssets,
        args: [],
        delay: 300,
        response: {
          success: true,
          data: [asset({ tags: ['Layer1_Layer2', 'pos'] })],
        },
      },
      profile('SOL', { alias: 'SOL', al: ACADEMY, rsu: RESEARCH }),
    ],
    [spy, ...getDefaultManagers()],
  );
  const profileAt = calls.findIndex(key => key.includes('token-info'));
  const assetsAt = calls.findIndex(key => key.includes('get-all-asset'));
  expect(profileAt).toBeGreaterThanOrEqual(0);
  expect(assetsAt).toBeGreaterThan(profileAt);
  expect(textOf('asset-name')).toBe('SOL');
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 350));
  });
});

it('does not request token-info on release web', async () => {
  const prior = Platform.OS;
  const dev = __DEV__;
  const calls: string[] = [];
  const spy: Manager = {
    middleware: () => next => async action => {
      if (action.type === actionTypes.FETCH && typeof action.key === 'string') calls.push(action.key);
      return next(action);
    },
    cleanup() {},
  };
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  try {
    await mountLive(
      'TSLABUSDT',
      [
        {
          endpoint: getExchangeInfo,
          args: [],
          response: { symbols: [pair('TSLABUSDT', 'TSLAB')] },
        },
        {
          endpoint: getAssets,
          args: [],
          response: {
            success: true,
            data: [asset({ assetCode: 'TSLAB', assetName: 'Tesla (bStocks)', tags: ['bStocks'] })],
          },
        },
        profile('TSLAB', { alias: 'TSLAB', al: null, rsu: null, wpu: null }),
      ],
      [spy, ...getDefaultManagers()],
    );
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(calls.some(key => key.includes('token-info'))).toBe(false);
    expect(textOf('asset-kinds')).toBe('Tokenized stock');
    expect(textOf('asset-concept-1')).toBe('What are bStocks? Binance Academy');
    expect(node('asset-academy')).toBeUndefined();
    expect(node('asset-research')).toBeUndefined();
    expect(node('asset-whitepaper')).toBeUndefined();
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: prior });
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
  }
});

it('drops BounceBit’s second concept when Seed is showing', () => {
  mount(
    'BBUSDT',
    screenFixtures('BBUSDT', 'BB', {
      assetName: 'BounceBit',
      tags: ['Layer1_Layer2', 'Seed', 'Megadrop', 'RWA'],
    }, {
      alias: 'BB',
      al: 'https://www.binance.com/en/academy/articles/what-is-bouncebit-bb',
      rsu: 'https://www.binance.com/en/research/projects/bouncebit',
      wpu: 'https://docs.bouncebit.io/',
    }),
  );
  expect(textOf('asset-caution-badge')).toBe('Seed');
  expect(textOf('asset-academy')).toBe('What is BounceBit? Binance Academy');
  expect(textOf('asset-concept-1')).toBe('Layer 1 vs layer 2 Binance Academy');
  expect(node('asset-concept-2')).toBeUndefined();
  expect(textOf('asset-research')).toBe('BounceBit research Binance Research');
  expect(textOf('asset-whitepaper')).toBe('BounceBit whitepaper docs.bouncebit.io');
});

it('shows Bitcoin’s payments primer and bitcoin.org', () => {
  mount(
    'BTCUSDT',
    screenFixtures('BTCUSDT', 'BTC', {
      assetName: 'Bitcoin',
      tags: ['Payments', 'mining-zone'],
    }, {
      alias: 'BTC',
      al: 'https://www.binance.com/en/academy/articles/what-is-bitcoin',
      rsu: 'https://www.binance.com/en/research/projects/bitcoin',
      wpu: 'https://bitcoin.org/bitcoin.pdf',
    }),
  );
  expect(textOf('asset-kinds')).toBe('Payments');
  expect(textOf('asset-concept-1')).toBe('Crypto payments explained Binance Academy');
  expect(node('asset-concept-2')).toBeUndefined();
  expect(textOf('asset-whitepaper')).toBe('Bitcoin whitepaper bitcoin.org');
});

it('shows USDC’s stablecoin primer and the hubspot host', () => {
  mount(
    'USDCUSDT',
    screenFixtures('USDCUSDT', 'USDC', {
      assetName: 'USDC',
      tags: ['stablecoin'],
    }, {
      alias: 'USDC',
      al: null,
      rsu: null,
      wpu: 'https://f.hubspotusercontent30.net/hubfs/9304636/PDF/centre-whitepaper.pdf',
    }),
  );
  expect(node('asset-academy')).toBeUndefined();
  expect(node('asset-research')).toBeUndefined();
  expect(textOf('asset-concept-1')).toBe('What is a stablecoin? Binance Academy');
  expect(textOf('asset-whitepaper')).toBe('USDC whitepaper f.hubspotusercontent30.net');
});

it('gives PAXG one real-world-assets primer', () => {
  mount(
    'PAXGUSDT',
    screenFixtures('PAXGUSDT', 'PAXG', {
      assetName: 'PAX Gold',
      tags: ['tCommodities'],
    }, {
      alias: 'PAXG',
      al: 'https://www.binance.com/en/academy/articles/what-is-pax-gold-paxg',
      rsu: 'https://www.binance.com/en/research/projects/pax-gold',
      wpu: 'https://www.paxos.com/pax-gold',
    }),
  );
  expect(textOf('asset-concept-1')).toBe('What are real-world assets? Binance Academy');
  expect(node('asset-concept-2')).toBeUndefined();
  expect(textOf('asset-whitepaper')).toBe('PAX Gold whitepaper paxos.com');
});

it('gives MTL no primer when the only kind is Infrastructure', () => {
  mount(
    'MTLUSDT',
    screenFixtures('MTLUSDT', 'MTL', {
      assetName: 'Metal DAO',
      tags: ['Infrastructure'],
    }, { alias: 'MTL', al: null, rsu: null, wpu: null }),
  );
  expect(textOf('asset-kinds')).toBe('Infrastructure');
  expect(node('asset-concept-1')).toBeUndefined();
  expect(node('asset-academy')).toBeUndefined();
  expect(node('asset-whitepaper')).toBeUndefined();
});

it('keeps Solana’s primers when token-info data is null', () => {
  mount(
    'SOLUSDT',
    screenFixtures('SOLUSDT', 'SOL', {
      assetName: 'Solana',
      tags: ['Layer1_Layer2', 'pos', 'mining-zone', 'Solana'],
    }, null),
  );
  expect(textOf('asset-concept-1')).toBe('Layer 1 vs layer 2 Binance Academy');
  expect(textOf('asset-concept-2')).toBe('Proof of stake explained Binance Academy');
  expect(node('asset-academy')).toBeUndefined();
  expect(node('asset-research')).toBeUndefined();
  expect(node('asset-whitepaper')).toBeUndefined();
});

it('rejects a shortener whitepaper and still shows the DeFi primer', () => {
  mount(
    'MAVUSDT',
    screenFixtures('MAVUSDT', 'MAV', {
      assetName: 'Maverick Protocol',
      tags: ['Infrastructure', 'Launchpool', 'defi'],
    }, {
      alias: 'MAV',
      al: null,
      rsu: 'https://www.binance.com/en/research/projects/maverick-protocol',
      wpu: 'https://bit.ly/MavWhitepaper',
    }),
  );
  expect(textOf('asset-kinds')).toBe('Infrastructure, DeFi');
  expect(textOf('asset-concept-1')).toBe('A beginner\u2019s guide to DeFi Binance Academy');
  expect(node('asset-concept-2')).toBeUndefined();
  expect(node('asset-whitepaper')).toBeUndefined();
  expect(textOf('asset-research')).toContain('Maverick Protocol research');
});

it('keeps the primers when token-info fails', async () => {
  await mountLive('SOLUSDT', [
    {
      endpoint: getExchangeInfo,
      args: [],
      response: { symbols: [pair('SOLUSDT', 'SOL')] },
    },
    {
      endpoint: getAssets,
      args: [],
      response: {
        success: true,
        data: [asset({ tags: ['Layer1_Layer2', 'pos'] })],
      },
    },
    {
      endpoint: getAssetProfile,
      args: [{ symbol: 'SOL' }],
      response: new TypeError('Failed to fetch'),
      error: true,
    },
  ]);
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  expect(textOf('asset-name')).toBe('Solana');
  expect(textOf('asset-concept-1')).toBe('Layer 1 vs layer 2 Binance Academy');
  expect(textOf('asset-concept-2')).toBe('Proof of stake explained Binance Academy');
  expect(node('asset-academy')).toBeUndefined();
  expect(node('load-error')).toBeUndefined();
  expect(ROW_IDS.every(id => node(id))).toBe(true);
});

it('paints the path once, after token-info, not concept rows first', async () => {
  await mountLive('SOLUSDT', [
    {
      endpoint: getExchangeInfo,
      args: [],
      response: { symbols: [pair('SOLUSDT', 'SOL')] },
    },
    {
      endpoint: getAssets,
      args: [],
      delay: 150,
      response: {
        success: true,
        data: [asset({ tags: ['Layer1_Layer2', 'pos'] })],
      },
    },
    {
      ...profile('SOL', { alias: 'SOL', al: ACADEMY, rsu: RESEARCH, wpu: SOL_PAPER }),
      delay: 400,
    },
  ]);
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
  });
  expect(textOf('asset-kinds')).toContain('Layer 1 / Layer 2');
  expect(node('asset-academy')).toBeUndefined();
  expect(node('asset-concept-1')).toBeUndefined();
  const before = flat('info-status');
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
  });
  expect(textOf('asset-academy')).toBe('What is Solana? Binance Academy');
  expect(textOf('asset-concept-1')).toBe('Layer 1 vs layer 2 Binance Academy');
  expect(flat('info-status').height).toBe(before.height);
});

it('shows the stored path before a stale refresh adds a row', async () => {
  const past = NOW - 60 * 60 * 1000 - 1000;
  jest.spyOn(Date, 'now').mockReturnValue(past);
  const initialState = mockInitialState([
    {
      endpoint: getExchangeInfo,
      args: [],
      response: { symbols: [pair('SOLUSDT', 'SOL')] },
    },
    {
      endpoint: getAssets,
      args: [],
      response: {
        success: true,
        data: [asset({ tags: ['Layer1_Layer2', 'pos'] })],
      },
    },
    profile('SOL', { alias: 'SOL', al: null, rsu: RESEARCH, wpu: SOL_PAPER }),
  ]);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  await mountLive(
    'SOLUSDT',
    [
      {
        endpoint: getExchangeInfo,
        args: [],
        response: { symbols: [pair('SOLUSDT', 'SOL')] },
      },
      {
        endpoint: getAssets,
        args: [],
        response: {
          success: true,
          data: [asset({ tags: ['Layer1_Layer2', 'pos'] })],
        },
      },
      {
        ...profile('SOL', { alias: 'SOL', al: ACADEMY, rsu: RESEARCH, wpu: SOL_PAPER }),
        delay: 200,
      },
    ],
    undefined,
    initialState,
  );
  expect(node('asset-academy')).toBeUndefined();
  expect(textOf('asset-research')).toBe('Solana research Binance Research');
  expect(textOf('asset-concept-1')).toBe('Layer 1 vs layer 2 Binance Academy');
  const before = flat('info-base');
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
  });
  expect(textOf('asset-academy')).toBe('What is Solana? Binance Academy');
  expect(flat('info-base').height).toBe(before.height);
  expect(textOf('info-base')).toContain('SOL');
});

it('shows the primers after token-info is still pending at 10 seconds', async () => {
  jest.useFakeTimers({ doNotFake: ['Date'] });
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (!url.includes('token-info')) return Promise.reject(new Error(`unexpected ${url}`));
    return new Promise((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (!signal) {
        reject(new Error('missing signal'));
        return;
      }
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });
  try {
    await mountLive('SOLUSDT', [
      {
        endpoint: getExchangeInfo,
        args: [],
        response: { symbols: [pair('SOLUSDT', 'SOL')] },
      },
      {
        endpoint: getAssets,
        args: [],
        response: {
          success: true,
          data: [asset({ tags: ['Layer1_Layer2', 'pos'] })],
        },
      },
    ]);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(textOf('asset-kinds')).toContain('Proof of stake');
    expect(node('asset-concept-1')).toBeUndefined();
    expect(node('asset-academy')).toBeUndefined();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(textOf('asset-concept-1')).toBe('Layer 1 vs layer 2 Binance Academy');
    expect(textOf('asset-concept-2')).toBe('Proof of stake explained Binance Academy');
    expect(node('asset-academy')).toBeUndefined();
    expect(node('load-error')).toBeUndefined();
    expect(ROW_IDS.every(id => node(id))).toBe(true);
  } finally {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  }
});
