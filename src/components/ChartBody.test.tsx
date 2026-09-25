jest.mock('@reactive/silk-native', () => {
  const React = require('react');
  const { Pressable, Text: RNText, View } = require('react-native');
  const theme = {
    semantic: {
      radius: { full: 999 },
      color: {
        surface: '#fff',
        textSecondary: '#666',
        borderSubtle: '#ddd',
        tones: {
          success: { solid: '#0a0' },
          danger: { solid: '#c00' },
          neutral: { subtleActive: '#eee' },
        },
      },
    },
  };
  return {
    SilkProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => ({ theme }),
    Text: ({ children, ...rest }: { children?: React.ReactNode }) =>
      React.createElement(RNText, rest, children),
    Button: ({
      children,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) =>
      React.createElement(
        Pressable,
        { onPress, testID },
        React.createElement(RNText, null, children),
      ),
  };
});

import { DataProvider, getDefaultManagers, useController } from '@data-client/react';
import type { Controller } from '@data-client/react';
import { mockInitialState, MockResolver } from '@data-client/test';
import { useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TestRenderer, { type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import ChartBody from '@/components/ChartBody';
import { intervalMs, periodStart } from '@/components/chartMotion';
import { getCandles, INTERVALS, upsertCandle, type CandleInterval } from '@/resources/Candle';
import CandleStream from '@/resources/CandleStream';
import { FakeSocket, installFakeSocket } from '@/resources/testSocket';

const { act } = TestRenderer;

const NOW = Date.parse('2026-09-23T15:04:30.000Z');
const SYMBOL = 'BTCUSDT';
const MINUTE = 60_000;

function period(now: number, interval: CandleInterval): number {
  return periodStart(now, interval);
}

function row(openTime: number, close: number): unknown[] {
  return [
    openTime,
    '100',
    '110',
    '90',
    String(close),
    '5',
    openTime + MINUTE,
    '500',
    10,
    '1',
    '1',
    '0',
  ];
}

type Seed = {
  endpoint: typeof getCandles;
  args: [{ symbol: string; interval: CandleInterval }];
  response: unknown;
};

function seed(interval: CandleInterval, openTime: number, close: number): Seed {
  return {
    endpoint: getCandles,
    args: [{ symbol: SYMBOL, interval }],
    response: [row(openTime, close)],
  };
}

function series(interval: CandleInterval, count = 60): Seed {
  const newest = period(NOW, interval);
  const opens: number[] = [];
  if (interval === '1M') {
    let cursor = newest;
    for (let i = 0; i < count; i += 1) {
      opens.push(cursor);
      const date = new Date(cursor);
      cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
    }
    opens.reverse();
  } else {
    const step = intervalMs(interval);
    for (let i = count - 1; i >= 0; i -= 1) opens.push(newest - i * step);
  }
  return {
    endpoint: getCandles,
    args: [{ symbol: SYMBOL, interval }],
    response: opens.map((openTime, index) => row(openTime, 100 + (index % 7) + 1)),
  };
}

let tree: ReactTestRenderer | undefined;
let restoreSocket = () => {};
let streams: CandleStream[] = [];
let fetches: CandleInterval[] = [];
let controller: Controller | undefined;

const metrics = {
  frame: { x: 0, y: 0, width: 384, height: 832 },
  insets: { top: 47, left: 0, right: 0, bottom: 24 },
};

function Bind(): null {
  controller = useController();
  return null;
}

function fireLayouts() {
  if (!tree) return;
  let nodes: ReactTestInstance[];
  try {
    nodes = tree.root.findAll(
    item =>
      typeof item.props.onLayout === 'function' &&
      typeof item.props.testID === 'string' &&
      item.props.testID.startsWith('candle-series'),
    );
  } catch {
    return;
  }
  for (const item of nodes) item.props.onLayout();
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise<void>(resolve => {
        setImmediate(() => resolve());
      });
    });
  }
}

async function advance(ms: number) {
  await flush();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
  await flush();
  await act(async () => {
    fireLayouts();
  });
}

function node(testID: string): ReactTestInstance | undefined {
  const found = tree?.root.findAll(item => item.props.testID === testID) ?? [];
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
  return parts.join('');
}

function present(testID: string): boolean {
  return (tree?.root.findAll(item => item.props.testID === testID).length ?? 0) > 0;
}

async function press(testID: string) {
  const target = tree?.root.findByProps({ testID });
  if (!target) throw new Error(`missing ${testID}`);
  await act(async () => {
    target.props.onPress();
  });
  await flush();
}

async function pressIn(testID: string) {
  const target = tree?.root.findByProps({ testID });
  if (!target) throw new Error(`missing ${testID}`);
  await act(async () => {
    target.props.onPressIn();
  });
  await flush();
}

function openKlines(): string[] {
  return FakeSocket.instances
    .filter(socket => socket.url.includes('@kline_') && !socket.closed)
    .map(socket => socket.url);
}

function selected(interval: CandleInterval): boolean {
  return node(`interval-${interval}`)?.props.accessibilityState?.selected === true;
}

function plotSize() {
  const plot = node('candles');
  const readout = node('candle-readout');
  return {
    plot: plot ? StyleSheet.flatten(plot.props.style) : undefined,
    readout: readout ? StyleSheet.flatten(readout.props.style) : undefined,
  };
}

function Harness({
  interval,
  seeds,
  resolve,
  delay,
  onRetry,
  show = true,
}: {
  interval: CandleInterval;
  seeds: Seed[];
  resolve: (params: { symbol: string; interval: CandleInterval }) => unknown;
  delay: (interval: CandleInterval) => number;
  onRetry: () => void;
  show?: boolean;
}) {
  const [current, setCurrent] = useState(interval);
  const [interceptor] = useState(() => () => ({}));
  const [fixtures] = useState(() => [
    {
      endpoint: getCandles,
      delay: (params: { interval: CandleInterval }) => delay(params.interval),
      response(params: { symbol: string; interval: CandleInterval }) {
        fetches.push(params.interval);
        return resolve(params);
      },
    },
  ]);
  const [state] = useState(() => mockInitialState(seeds));
  const [managers] = useState(() => {
    const stream = new CandleStream();
    streams.push(stream);
    return [stream, ...getDefaultManagers()];
  });
  return (
    <DataProvider initialState={state} managers={managers}>
      <MockResolver fixtures={fixtures} getInitialInterceptorData={interceptor}>
        <Bind />
        <SafeAreaProvider initialMetrics={metrics}>
          {show ?
            <ChartBody
              symbol={SYMBOL}
              interval={current}
              onInterval={setCurrent}
              onRetry={onRetry}
              retry={0}
            />
          : null}
        </SafeAreaProvider>
      </MockResolver>
    </DataProvider>
  );
}

function mount(props: Omit<React.ComponentProps<typeof Harness>, 'onRetry'> & { onRetry?: () => void }) {
  const onRetry = props.onRetry ?? jest.fn();
  act(() => {
    tree = TestRenderer.create(<Harness {...props} onRetry={onRetry} />);
  });
  return onRetry;
}

async function settle() {
  await flush();
  await act(async () => {
    fireLayouts();
  });
  await advance(180);
}

beforeEach(() => {
  fetches = [];
  streams = [];
  controller = undefined;
  const installed = installFakeSocket();
  restoreSocket = installed.restore;
  Dimensions.set({
    window: { width: 384, height: 832, scale: 3.75, fontScale: 1 },
    screen: { width: 384, height: 832, scale: 3.75, fontScale: 1 },
  });
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
  });
});

afterEach(() => {
  act(() => {
    tree?.unmount();
  });
  tree = undefined;
  for (const stream of streams) stream.cleanup();
  restoreSocket();
  jest.useRealTimers();
  jest.restoreAllMocks();
  // spyOn on the preset's jest.fn does not register a restore, so
  // mockResolvedValue(true) would stick for every later test.
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockImplementation(() =>
    Promise.resolve(false),
  );
  (AccessibilityInfo.addEventListener as jest.Mock).mockImplementation(() => ({
    remove() {},
  }));
});

const current15 = () => seed('15m', period(NOW, '15m'), 111);

function keepSize() {
  const size = plotSize();
  expect(size.plot?.width).toBe(360);
  expect(size.plot?.height).toBe(521);
  expect(size.readout?.height).toBe(40);
}

it('fades to a delayed 1h list without the first-load sentence', async () => {
  mount({
    interval: '15m',
    seeds: [current15()],
    delay: interval => (interval === '1h' ? 2000 : 0),
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await settle();
  expect(present('chart-loading')).toBe(false);
  expect(textOf('candle-close')).toBe('111');

  await press('interval-1h');
  expect(selected('1h')).toBe(true);
  expect(present('chart-loading')).toBe(false);
  const outgoing = node('candle-series-15m');
  expect(outgoing?.props.accessibilityElementsHidden).toBe(true);
  expect(outgoing?.props.importantForAccessibility).toBe('no-hide-descendants');
  keepSize();
  expect(present('chart-caption')).toBe(false);

  await advance(399);
  expect(present('chart-caption')).toBe(false);
  await advance(1);
  expect(textOf('chart-caption')).toBe('Loading 1h candles');
  expect(present('candle-series-1h')).toBe(false);
  keepSize();

  await advance(1600);
  expect(present('candle-series-1h')).toBe(true);
  expect(textOf('candle-close')).toBe('222');
  expect(present('chart-caption')).toBe(false);
  expect(present('chart-loading')).toBe(false);
  keepSize();
});

it('holds the caption until 700ms when the list arrives at 450ms', async () => {
  mount({
    interval: '15m',
    seeds: [current15()],
    delay: interval => (interval === '4h' ? 450 : 0),
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await settle();
  await press('interval-4h');
  await advance(450);
  expect(textOf('chart-caption')).toBe('Loading 4h candles');
  expect(present('candle-series-4h')).toBe(false);

  await advance(249);
  expect(present('candle-series-4h')).toBe(false);
  expect(present('chart-caption')).toBe(true);

  await advance(1);
  expect(present('candle-series-4h')).toBe(true);
  expect(present('chart-caption')).toBe(false);
});

it('never mounts an intermediate interval when 1h resolves before 4h', async () => {
  mount({
    interval: '15m',
    seeds: [current15()],
    delay: interval => (interval === '1h' ? 100 : interval === '4h' ? 500 : 0),
    resolve: params => [row(period(Date.now(), params.interval), params.interval === '4h' ? 444 : 222)],
  });
  await settle();
  await press('interval-1h');
  await press('interval-4h');
  expect(selected('4h')).toBe(true);

  await advance(200);
  expect(present('candle-series-1h')).toBe(false);
  expect(fetches).toEqual(expect.arrayContaining(['1h', '4h']));
  expect(fetches).not.toContain('15m');

  await advance(500);
  expect(present('candle-series-1h')).toBe(false);
  expect(present('candle-series-4h')).toBe(true);
  expect(textOf('candle-close')).toBe('444');
});

it('fades out a series that is still fading in', async () => {
  mount({
    interval: '15m',
    seeds: [current15()],
    delay: interval => (interval === '4h' ? 300 : 0),
    resolve: params => [row(period(Date.now(), params.interval), params.interval === '4h' ? 444 : 222)],
  });
  await settle();
  await press('interval-1h');
  await advance(90);
  expect(present('candle-series-1h')).toBe(true);

  await advance(40);
  await press('interval-4h');
  expect(present('candle-series-1h')).toBe(true);
  expect(present('candle-series-4h')).toBe(false);

  await advance(90);
  expect(present('candle-series-1h')).toBe(false);
  await advance(300);
  expect(present('candle-series-4h')).toBe(true);
  expect(textOf('candle-close')).toBe('444');
});

it('cancels a switch back to the still-mounted interval without a fetch', async () => {
  mount({
    interval: '15m',
    seeds: [current15()],
    delay: interval => (interval === '1h' ? 2000 : 0),
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await settle();
  const before = fetches.length;
  await press('interval-1h');
  await press('interval-15m');
  expect(fetches.filter(interval => interval === '15m')).toEqual([]);
  expect(fetches).toContain('1h');
  expect(fetches.slice(before)).not.toContain('15m');
  expect(present('candle-series-15m')).toBe(true);
  expect(present('candle-series-1h')).toBe(false);
  expect(selected('15m')).toBe(true);
  const opacity = node('candle-series-15m')?.props.style?.opacity;
  expect(typeof opacity?.__getValue).toBe('function');
  expect(opacity.__getValue()).toBe(1);
});

it('keeps the frozen outgoing close when a kline arrives mid-fade', async () => {
  mount({
    interval: '15m',
    seeds: [current15()],
    delay: interval => (interval === '1h' ? 2000 : 0),
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await settle();
  expect(textOf('candle-close')).toBe('111');
  await press('interval-1h');
  act(() => {
    void controller?.set(
      upsertCandle,
      { symbol: SYMBOL, interval: '15m' },
      [{ t: period(NOW, '15m'), o: '100', h: '110', l: '90', c: '999', v: '5', n: 20 }],
    );
  });
  expect(textOf('candle-close')).toBe('111');
  expect(present('candle-last')).toBe(true);
  expect(present('candle-series-15m')).toBe(true);
});

it('keeps a chart-local failure inside the frame and retries only the chart', async () => {
  const onRetry = mount({
    interval: '15m',
    seeds: [current15()],
    delay: () => 0,
    resolve: params => {
      if (params.interval === '1h') throw new TypeError('Failed to fetch');
      return [row(period(Date.now(), params.interval), 111)];
    },
  });
  await settle();
  await press('interval-1h');
  await advance(90);
  expect(present('load-error')).toBe(true);
  expect(textOf('load-error')).toContain('BTCUSDT 1h candles');
  expect(selected('1h')).toBe(true);
  expect(present('chart-loading')).toBe(false);
  keepSize();

  await press('load-retry');
  await flush();
  expect(onRetry).not.toHaveBeenCalled();
  expect(present('chart-loading')).toBe(false);

  await press('interval-15m');
  await advance(180);
  expect(fetches.filter(interval => interval === '15m')).toEqual([]);
  expect(present('load-error')).toBe(false);
  expect(present('candle-series-15m')).toBe(true);
  expect(textOf('candle-close')).toBe('111');
});

it('fetches a cached list from the previous minute and skips a current one', async () => {
  const staleOpen = period(NOW, '1m') - MINUTE;
  mount({
    interval: '15m',
    seeds: [current15(), seed('1w', period(NOW, '1w') - 7 * 24 * 60 * MINUTE, 50), seed('4h', period(NOW, '4h'), 333)],
    delay: interval => (interval === '1w' ? 800 : 0),
    resolve: params => [row(period(Date.now(), params.interval), 444)],
  });
  await settle();

  await press('interval-4h');
  await advance(520);
  expect(fetches).not.toContain('4h');
  expect(present('candle-series-4h')).toBe(true);
  expect(present('candle-series-15m')).toBe(false);
  expect(textOf('candle-close')).toBe('333');

  await press('interval-1w');
  expect(fetches).toContain('1w');
  expect(textOf('candle-close')).not.toBe('50');
  await advance(90);
  expect(present('candle-series-1w')).toBe(false);
  expect(textOf('candle-close')).not.toBe('444');
  await advance(200);
  expect(present('candle-series-1w')).toBe(true);
  expect(textOf('candle-close')).toBe('444');
});

it('treats a soft-errored cache as a failure and does not paint it', async () => {
  mount({
    interval: '15m',
    seeds: [current15(), seed('1h', period(NOW, '1h'), 333)],
    delay: () => 0,
    resolve: params => {
      if (params.interval === '1h') throw new TypeError('Failed to fetch');
      return [row(period(Date.now(), params.interval), 111)];
    },
  });
  await settle();
  act(() => {
    void controller?.resolve(getCandles, {
      args: [{ symbol: SYMBOL, interval: '1h' }],
      response: new TypeError('Failed to fetch'),
      fetchedAt: Date.now(),
      error: true,
    });
  });
  await flush();
  await press('interval-1h');
  await advance(90);
  expect(textOf('candle-close')).not.toBe('333');
  expect(present('candle-series-1h')).toBe(false);
  expect(present('load-error')).toBe(true);
  expect(present('chart-loading')).toBe(false);
});

it('shows the 10s failure and replaces it when the response lands', async () => {
  mount({
    interval: '15m',
    seeds: [current15()],
    delay: interval => (interval === '1h' ? 12_000 : 0),
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await settle();
  await press('interval-1h');
  await advance(10_000);
  expect(present('load-error')).toBe(true);
  expect(present('candle-series-1h')).toBe(false);
  expect(present('chart-loading')).toBe(false);

  await advance(2_000);
  expect(present('load-error')).toBe(false);
  expect(present('candle-series-1h')).toBe(true);
  expect(textOf('candle-close')).toBe('222');
});

it('does not paint an expired list when Chart mounts again', async () => {
  let setShow: (show: boolean) => void = () => {};
  function Switchable() {
    const [show, set] = useState(true);
    setShow = set;
    const [state] = useState(() => mockInitialState([seed('15m', period(NOW, '15m'), 111)]));
    const [managers] = useState(() => {
      const stream = new CandleStream();
      streams.push(stream);
      return [stream, ...getDefaultManagers()];
    });
    return (
      <DataProvider initialState={state} managers={managers}>
        <MockResolver
          fixtures={[
            {
              endpoint: getCandles,
              delay: 300,
              response() {
                fetches.push('15m');
                return [row(period(NOW, '15m'), 222)];
              },
            },
          ]}
        >
          <SafeAreaProvider initialMetrics={metrics}>
            {show ?
              <ChartBody
                symbol={SYMBOL}
                interval="15m"
                onInterval={() => {}}
                onRetry={() => {}}
                retry={0}
              />
            : null}
          </SafeAreaProvider>
        </MockResolver>
      </DataProvider>
    );
  }

  act(() => {
    tree = TestRenderer.create(<Switchable />);
  });
  await settle();
  expect(textOf('candle-close')).toBe('111');

  await act(async () => {
    setShow(false);
  });
  await advance(61_000);
  fetches = [];
  await act(async () => {
    setShow(true);
  });
  await flush();
  expect(present('chart-loading')).toBe(false);
  expect(textOf('candle-close')).not.toBe('111');
  expect(present('candle-series-15m')).toBe(false);

  await advance(300);
  expect(present('chart-loading')).toBe(false);
  expect(textOf('candle-close')).toBe('222');
  expect(fetches).toEqual(['15m']);
});

it('cuts to a ready interval in one commit when reduce motion is on', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove() {} });
  mount({
    interval: '15m',
    seeds: [current15(), seed('1h', period(NOW, '1h'), 222)],
    delay: () => 0,
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await flush();
  await press('interval-1h');
  expect(present('candle-series-1h')).toBe(true);
  expect(present('candle-series-15m')).toBe(false);
  expect(present('chart-caption')).toBe(false);
  expect(present('chart-loading')).toBe(false);
  expect(fetches).not.toContain('1h');
  expect(textOf('candle-close')).toBe('222');
});

it('fades in again when a series mounts a second time', async () => {
  mount({
    interval: '15m',
    seeds: [current15()],
    delay: interval => (interval === '4h' ? 2000 : 0),
    resolve: params => [row(period(Date.now(), params.interval), 111)],
  });
  await settle();
  await press('interval-4h');
  await advance(90);
  expect(present('candle-series-15m')).toBe(false);
  expect(present('candle-series-4h')).toBe(false);

  const timing = jest.spyOn(Animated, 'timing');
  await press('interval-15m');
  await advance(90);
  const fadeIn = timing.mock.calls.filter(call => {
    const config = call[1] as { toValue?: number } | undefined;
    return config?.toValue === 1;
  });
  expect(fadeIn.length).toBeGreaterThan(0);
  expect(present('candle-series-15m')).toBe(true);
  await advance(180);
  expect(textOf('candle-close')).toBe('111');
});

it('keeps a cached reveal when an abandoned fetch finishes during the caption', async () => {
  mount({
    interval: '15m',
    seeds: [current15(), seed('4h', period(NOW, '4h'), 333)],
    delay: interval => (interval === '1h' ? 500 : 0),
    resolve: params => [row(period(Date.now(), params.interval), params.interval === '4h' ? 333 : 222)],
  });
  await settle();
  await press('interval-1h');
  await advance(450);
  expect(textOf('chart-caption')).toBe('Loading 1h candles');
  expect(present('candle-series-1h')).toBe(false);

  await press('interval-4h');
  await advance(40);
  expect(present('candle-series-4h')).toBe(false);
  await advance(220);
  expect(present('candle-series-4h')).toBe(true);
  expect(present('candle-series-1h')).toBe(false);
  expect(present('load-error')).toBe(false);
  expect(present('chart-loading')).toBe(false);
  expect(textOf('candle-close')).toBe('333');
});

async function showPair(from: CandleInterval, to: CandleInterval) {
  if (tree) {
    act(() => {
      tree?.unmount();
    });
    tree = undefined;
    for (const stream of streams) stream.cleanup();
    streams = [];
    FakeSocket.instances = [];
  }
  fetches = [];
  mount({
    interval: from,
    seeds: [series(from), series(to)],
    delay: () => 0,
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await settle();
}

it('travels week-month and a far jump from the pills', async () => {
  const faded: string[] = [];
  for (const [from, to] of [
    ['1w', '1M'],
    ['1M', '1w'],
    ['1m', '1d'],
    ['1d', '1m'],
  ] as const) {
    await showPair(from, to);
    await press(`interval-${to}`);
    await advance(1);
    const origin = node(`candle-series-${from}`);
    const traveling =
      origin != null &&
      origin.props.accessible !== true &&
      origin.props.accessibilityElementsHidden === true;
    if (!traveling) faded.push(`${from}->${to}`);
  }
  expect(faded).toEqual([]);
});

it('reverses a far travel across handoffs without fetching the origin', async () => {
  mount({
    interval: '1m',
    seeds: [series('1m'), series('1d')],
    delay: () => 0,
    resolve: params => series(params.interval).response,
  });
  await settle();
  const before = fetches.length;
  await press('interval-1d');
  await advance(1);
  expect(node('candle-series-1m')?.props.accessibilityElementsHidden).toBe(true);
  await press('interval-1m');
  expect(fetches.slice(before)).not.toContain('1m');
  expect(selected('1m')).toBe(true);
  expect(present('candle-series-1m')).toBe(true);
  await advance(1000);
  expect(present('candle-series-1m')).toBe(true);
  expect(present('candle-series-1d')).toBe(false);
  expect(fetches.slice(before)).not.toContain('1m');
});

it('fetches the other pills after a settle, neighbours first', async () => {
  mount({
    interval: '1h',
    seeds: [series('1h')],
    delay: () => 0,
    resolve: params => series(params.interval).response,
  });
  await settle();
  await advance(1);
  const order = fetches.filter((interval, index) => fetches.indexOf(interval) === index);
  expect(order).toEqual(['15m', '4h', '1m', '1d', '1w', '1M']);
});

it('keeps a left interval through GC while the chart stays mounted', async () => {
  mount({
    interval: '15m',
    seeds: [series('15m'), series('1h')],
    delay: () => 0,
    resolve: params => series(params.interval).response,
  });
  await settle();
  await press('interval-1h');
  await advance(1000);
  expect(present('candle-series-15m')).toBe(false);
  const args = { symbol: SYMBOL, interval: '15m' as const };
  const count = () => {
    const state = controller?.getState();
    if (!state || !controller) return 0;
    const key = getCandles.key(args);
    if (state.endpoints[key] === undefined) return 0;
    const { data } = controller.getResponseMeta(getCandles, args, state);
    return Array.isArray(data) ? data.length : 0;
  };
  expect(count()).toBeGreaterThan(0);
  jest.setSystemTime(Date.now() + 3 * 60_000);
  (controller?.gcPolicy as unknown as { runSweep(): void }).runSweep();
  expect(count()).toBeGreaterThan(0);
});

it('travels when a press-in fetch resolves before touch-up', async () => {
  let hourAttempts = 0;
  mount({
    interval: '15m',
    seeds: [series('15m')],
    delay: () => 0,
    resolve: params => {
      if (params.interval === '1h') {
        hourAttempts += 1;
        if (hourAttempts === 1) throw new TypeError('Failed to fetch');
      }
      return series(params.interval).response;
    },
  });
  await settle();
  expect(hourAttempts).toBe(1);
  expect(present('candle-series-1h')).toBe(false);
  await pressIn('interval-1h');
  expect(hourAttempts).toBe(2);
  await press('interval-1h');
  await advance(1);
  expect(present('candle-series-15m')).toBe(true);
  expect(present('candle-series-1h')).toBe(true);
  expect(selected('1h')).toBe(true);
});

it('reverses a travel without a fetch and fades a third pill', async () => {
  mount({
    interval: '15m',
    seeds: [series('15m'), series('1h')],
    delay: interval => (interval === '4h' ? 2000 : 0),
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await settle();
  const before = fetches.length;
  await press('interval-1h');
  await advance(1);
  expect(present('candle-series-15m')).toBe(true);
  expect(present('candle-series-1h')).toBe(true);
  await advance(40);
  expect(present('candle-series-15m')).toBe(true);
  expect(present('candle-series-1h')).toBe(true);
  const close = textOf('candle-close');
  act(() => {
    void controller?.set(
      upsertCandle,
      { symbol: SYMBOL, interval: '15m' },
      [{ t: period(NOW, '15m'), o: '100', h: '110', l: '90', c: '999', v: '5', n: 20 }],
    );
  });
  expect(textOf('candle-close')).toBe(close);

  await press('interval-15m');
  expect(fetches.slice(before)).not.toContain('15m');
  expect(present('candle-series-15m')).toBe(true);
  expect(present('candle-series-1h')).toBe(true);
  expect(textOf('candle-close')).toBe(close);
  expect(selected('15m')).toBe(true);

  await advance(800);
  expect(present('candle-series-15m')).toBe(true);
  expect(present('candle-series-1h')).toBe(false);

  await press('interval-1h');
  await advance(1);
  await press('interval-4h');
  expect(selected('4h')).toBe(true);
  await advance(90);
  expect(present('candle-series-15m')).toBe(false);
  expect(present('candle-series-1h')).toBe(false);
  expect(present('candle-series-4h')).toBe(false);
});

it('settles a resize during reverse on the interval the pill shows', async () => {
  mount({
    interval: '15m',
    seeds: [series('15m'), series('1h')],
    delay: () => 0,
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await settle();
  await press('interval-1h');
  await advance(1);
  await advance(40);
  expect(present('candle-series-15m')).toBe(true);
  expect(present('candle-series-1h')).toBe(true);
  await press('interval-15m');
  expect(selected('15m')).toBe(true);
  expect(present('candle-series-15m')).toBe(true);
  expect(present('candle-series-1h')).toBe(true);

  await act(async () => {
    Dimensions.set({
      window: { width: 384, height: 900, scale: 3.75, fontScale: 1 },
      screen: { width: 384, height: 900, scale: 3.75, fontScale: 1 },
    });
  });
  await flush();

  expect(selected('15m')).toBe(true);
  expect(selected('1h')).toBe(false);
  expect(present('candle-series-15m')).toBe(true);
  expect(present('candle-series-1h')).toBe(false);
});

it('keeps one kline socket and fades when the travel start is late', async () => {
  mount({
    interval: '15m',
    seeds: [series('15m'), series('1h')],
    delay: () => 0,
    resolve: params => [row(period(Date.now(), params.interval), 222)],
  });
  await settle();
  expect(openKlines().filter(url => url.includes('kline_15m'))).toHaveLength(1);
  expect(openKlines().some(url => url.includes('kline_1h'))).toBe(false);

  const events: string[] = [];
  const originalClose = FakeSocket.prototype.close;
  FakeSocket.prototype.close = function close(this: FakeSocket) {
    if (this.url.includes('@kline_')) events.push(`close:${this.url}`);
    return originalClose.call(this);
  };
  const Socket = globalThis.WebSocket as unknown as typeof FakeSocket;
  globalThis.WebSocket = class extends Socket {
    constructor(url: string) {
      super(url);
      if (url.includes('@kline_')) events.push(`open:${url}`);
    }
  } as unknown as typeof WebSocket;

  await press('interval-1h');
  await advance(1);
  expect(openKlines()).toHaveLength(1);
  expect(openKlines()[0]).toContain('kline_15m');
  expect(events).toEqual([]);

  await advance(400);
  expect(events.map(event => (event.startsWith('close:') ? 'close' : 'open'))).toEqual(['close', 'open']);
  expect(events[0]).toContain('kline_15m');
  expect(events[1]).toContain('kline_1h');
  expect(openKlines()).toHaveLength(1);
  expect(openKlines()[0]).toContain('kline_1h');
  FakeSocket.prototype.close = originalClose;

  await press('interval-15m');
  jest.setSystemTime(Date.now() + 150);
  await advance(1);
  expect(present('candle-series-1h')).toBe(true);
  expect(present('candle-series-15m')).toBe(false);
});
