jest.mock('@reactive/silk-native', () => {
  const React = require('react');
  const { Text: RNText, TextInput, View } = require('react-native');
  const theme = {
    semantic: {
      color: {
        surface: '#ffffff',
        borderSubtle: '#d9d9d9',
        tones: { success: { solid: '#218358' }, danger: { solid: '#ce2c31' } },
      },
      typography: {
        label: { size: 14, lineHeight: 1.3 },
        caption: { size: 12, lineHeight: 1.35 },
      },
    },
  };
  return {
    SilkProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => ({ theme }),
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
    Input: ({ size: _size, ...rest }: { size?: string }) => React.createElement(TextInput, rest),
    Badge: ({ children, ...rest }: { children?: React.ReactNode }) =>
      React.createElement(View, rest, React.createElement(RNText, null, children)),
    Skeleton: (props: object) => React.createElement(View, props),
  };
});

import { DataProvider } from '@data-client/react';
import { mockInitialState } from '@data-client/test';
import { BackHandler } from 'react-native';
import TestRenderer, { type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { SymbolSearch } from '@/components/SymbolSearch';
import { getExchangeInfo } from '@/resources/Symbol';
import { actWrite } from '@/resources/testSupport';
import { getTickers, Ticker } from '@/resources/Ticker';

const { act } = TestRenderer;

function pair(symbol: string, base: string, quote: string, status = 'TRADING') {
  return {
    symbol,
    status,
    baseAsset: base,
    quoteAsset: quote,
    filters: [
      { filterType: 'PRICE_FILTER', tickSize: '0.01000000' },
      { filterType: 'LOT_SIZE', stepSize: '0.00001000' },
    ],
  };
}

function ticker(symbol: string, quoteVolume: string) {
  return {
    symbol,
    lastPrice: '101',
    openPrice: '100',
    highPrice: '102',
    lowPrice: '99',
    volume: '1',
    quoteVolume,
    closeTime: 1_000,
  };
}

const fixtures = [
  {
    endpoint: getExchangeInfo,
    args: [],
    response: {
      symbols: [
        pair('BTCUSDT', 'BTC', 'USDT'),
        pair('ETHUSDT', 'ETH', 'USDT'),
        pair('ETHFIUSDT', 'ETHFI', 'USDT'),
        pair('ETHBTC', 'ETH', 'BTC'),
        pair('SOLUSDT', 'SOL', 'USDT', 'HALT'),
      ],
    },
  },
  {
    endpoint: getTickers,
    args: [],
    response: [
      ticker('BTCUSDT', '500'),
      ticker('ETHUSDT', '200'),
      ticker('ETHFIUSDT', '10'),
      ticker('ETHBTC', '100'),
      ticker('SOLUSDT', '50'),
    ],
  },
];

let tree: ReactTestRenderer | undefined;
let controller: { set: (...args: any[]) => Promise<void> } | undefined;

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
  jest.restoreAllMocks();
});

function mount(withTickers = true) {
  const onChoose = jest.fn();
  const onDismiss = jest.fn();
  act(() => {
    tree = TestRenderer.create(
      <DataProvider initialState={mockInitialState(withTickers ? fixtures : fixtures.slice(0, 1))}>
        <ControllerProbe />
        <SymbolSearch onChoose={onChoose} onDismiss={onDismiss} />
      </DataProvider>,
    );
  });
  return { onChoose, onDismiss };
}

function ControllerProbe(): null {
  controller = require('@data-client/react').useController();
  return null;
}

function node(testID: string): ReactTestInstance | undefined {
  return tree?.root.findAll(item => item.props.testID === testID && typeof item.type !== 'string')[0];
}

function results(): string[] {
  return (
    tree?.root
      .findAll(
        item =>
          typeof item.props.testID === 'string' &&
          item.props.testID.startsWith('market-') &&
          typeof item.props.onPress === 'function',
      )
      .map(item => item.props.testID.slice('market-'.length))
      .filter((id, index, all) => all.indexOf(id) === index) ?? []
  );
}

function type(text: string) {
  act(() => {
    node('symbol-search-field')?.props.onChangeText(text);
  });
}

it('stays quiet until something is typed, then lists every quote as you type', () => {
  mount();
  expect(node('symbol-search-field')?.props.autoFocus).toBe(true);
  expect(results()).toEqual([]);
  expect(node('symbol-search-empty')).toBeUndefined();

  type('e');
  expect(results()).toEqual(['ETHUSDT', 'ETHFIUSDT', 'ETHBTC']);
  type('eth/b');
  expect(results()).toEqual(['ETHBTC']);
  type('sol');
  expect(results()).toEqual(['SOLUSDT']);
});

it('says only that nothing matches', () => {
  mount();
  type('zzzz');
  expect(results()).toEqual([]);
  expect(node('symbol-search-empty')?.props.children).toBe('No markets match');
});

it('hands the chosen symbol back', () => {
  const { onChoose, onDismiss } = mount();
  type('eth');
  act(() => {
    node('market-ETHBTC')?.props.onPress();
  });
  expect(onChoose).toHaveBeenCalledWith('ETHBTC');
  expect(onDismiss).not.toHaveBeenCalled();
});

it('dismisses from Cancel, Escape, and the system back gesture', () => {
  const handlers: (() => boolean | null | undefined)[] = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, handler) => {
    handlers.push(handler as () => boolean | null | undefined);
    return { remove: () => {} };
  });
  const { onDismiss } = mount();
  act(() => {
    node('symbol-search-cancel')?.props.onPress();
  });
  act(() => {
    node('symbol-search-field')?.props.onKeyPress({ nativeEvent: { key: 'Escape' } });
  });
  act(() => {
    node('symbol-search-field')?.props.onKeyPress({ nativeEvent: { key: 'e' } });
  });
  let consumed: boolean | null | undefined;
  act(() => {
    consumed = handlers.at(-1)?.();
  });
  expect(consumed).toBe(true);
  expect(onDismiss).toHaveBeenCalledTimes(3);
});

it('ranks by volume once quotes arrive, then keeps that order', () => {
  mount(false);
  type('eth');
  expect(results()).toEqual(['ETHUSDT', 'ETHFIUSDT', 'ETHBTC']);

  actWrite(() => {
    controller!.set(Ticker, { symbol: 'ETHUSDT' }, ticker('ETHUSDT', '10'));
    controller!.set(Ticker, { symbol: 'ETHFIUSDT' }, ticker('ETHFIUSDT', '900'));
    controller!.set(Ticker, { symbol: 'ETHBTC' }, ticker('ETHBTC', '100'));
  });
  expect(results()).toEqual(['ETHFIUSDT', 'ETHUSDT', 'ETHBTC']);

  actWrite(() => controller!.set(Ticker, { symbol: 'ETHUSDT' }, ticker('ETHUSDT', '5000')));
  expect(results()).toEqual(['ETHFIUSDT', 'ETHUSDT', 'ETHBTC']);
});

it('holds the rows on screen while a finger is down as volumes arrive', () => {
  mount(false);
  type('eth');
  act(() => {
    node('symbol-search-list')?.props.onPointerDown();
  });

  actWrite(() => {
    controller!.set(Ticker, { symbol: 'ETHUSDT' }, ticker('ETHUSDT', '10'));
    controller!.set(Ticker, { symbol: 'ETHFIUSDT' }, ticker('ETHFIUSDT', '900'));
    controller!.set(Ticker, { symbol: 'ETHBTC' }, ticker('ETHBTC', '100'));
  });
  expect(results()).toEqual(['ETHUSDT', 'ETHFIUSDT', 'ETHBTC']);

  act(() => {
    node('symbol-search-list')?.props.onPointerUp();
  });
  expect(results()).toEqual(['ETHFIUSDT', 'ETHUSDT', 'ETHBTC']);
});

it('keeps the order still between keystrokes while volumes move', () => {
  mount();
  type('eth');
  expect(results()).toEqual(['ETHUSDT', 'ETHFIUSDT', 'ETHBTC']);

  actWrite(() => controller!.set(Ticker, { symbol: 'ETHFIUSDT' }, ticker('ETHFIUSDT', '900')));
  expect(results()).toEqual(['ETHUSDT', 'ETHFIUSDT', 'ETHBTC']);

  type('et');
  expect(results()).toEqual(['ETHFIUSDT', 'ETHUSDT', 'ETHBTC']);
});
