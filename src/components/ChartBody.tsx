import { AsyncBoundary, useController, useLive, useQuery } from '@data-client/react';
import { Text, useTheme } from '@reactive/silk-native';
import {
  forwardRef,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type JSX,
  type Ref,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  PixelRatio,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cachedListReady,
  CAPTION_DELAY_MS,
  easeIn,
  easeOut,
  FADE_IN_MS,
  FADE_OUT_MS,
  FAILURE_MS,
  intervalLabel,
  revealAt,
} from '@/components/chartMotion';
import { LoadError } from '@/components/LoadError';
import { Pill } from '@/components/Pill';
import {
  candleLayout,
  candleMetrics,
  INTERVAL_ROW,
  PLOT_MARGIN,
  PLOT_PAD,
  plotDeviceShift,
  plotSize,
  READOUT,
} from '@/components/candleLayout';
import { decimalsOf, formatPrice } from '@/components/formatMarket';
import { getCandles, INTERVALS, type Candle, type CandleInterval } from '@/resources/Candle';
import { MarketSymbol } from '@/resources/Symbol';

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };
const NATIVE_DRIVER = Platform.OS !== 'web';
const LABELS = ['Open', 'High', 'Low', 'Close'] as const;

type Phase =
  | { kind: 'live' | 'in' | 'out'; interval: CandleInterval }
  | { kind: 'empty' }
  | { kind: 'fail' };

type Published = {
  interval: CandleInterval;
  candles: readonly Candle[];
  opacity: Animated.Value;
};

type SeriesHandle = {
  opacity: () => number;
  fadeTo: (to: number, duration: number, curve: 'in' | 'out') => void;
};

type CandleMeta = { error?: unknown; expiresAt: number } | undefined;

function useReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (live) setEnabled(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return enabled;
}

function readList(
  controller: ReturnType<typeof useController>,
  symbol: string,
  interval: CandleInterval,
): { exists: boolean; meta: CandleMeta; candles: Candle[] | undefined } {
  const state = controller.getState();
  const key = getCandles.key({ symbol, interval });
  const meta = state.meta[key] as CandleMeta;
  if (state.endpoints[key] === undefined) return { exists: false, meta, candles: undefined };
  const { data } = controller.getResponseMeta(getCandles, { symbol, interval }, state);
  const candles = Array.isArray(data) ? (data as Candle[]) : undefined;
  return { exists: true, meta, candles };
}

function listExists(
  controller: ReturnType<typeof useController>,
  symbol: string,
  interval: CandleInterval,
): boolean {
  return readList(controller, symbol, interval).exists;
}

function DeviceMark({
  style,
  testID,
}: {
  style: NonNullable<ComponentProps<typeof View>['style']>;
  testID?: string;
}): JSX.Element {
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={style}
    />
  );
}

function IntervalChips({
  value,
  onSelect,
}: {
  value: CandleInterval;
  onSelect: (interval: CandleInterval) => void;
}): JSX.Element {
  return (
    <View style={styles.chips}>
      {INTERVALS.map(item => {
        const selected = item.value === value;
        return (
          <Pill
            key={item.value}
            testID={`interval-${item.value}`}
            label={item.label}
            selected={selected}
            onPress={() => onSelect(item.value)}
          />
        );
      })}
    </View>
  );
}

const CandlePlot = memo(function CandlePlot({
  symbol,
  interval,
  candles,
  width,
  height,
  insetTop,
  insetLeft,
}: {
  symbol: string;
  interval: CandleInterval;
  candles: readonly Candle[];
  width: number;
  height: number;
  insetTop: number;
  insetLeft: number;
}): JSX.Element {
  const instrument = useQuery(MarketSymbol, { symbol });
  const { theme } = useTheme();
  const ratio = PixelRatio.get();
  const metrics = candleMetrics(width, ratio);
  const placed = candleLayout(candles, { width, height, ratio });
  const shift = plotDeviceShift(insetTop, insetLeft, ratio);
  const last = candles[candles.length - 1];
  const places = instrument?.pricePlaces ?? decimalsOf(last.close);
  const up = theme.semantic.color.tones.success.solid;
  const down = theme.semantic.color.tones.danger.solid;
  const flat = theme.semantic.color.textSecondary;
  const surface = theme.semantic.color.surface;
  const wickOffset = (metrics.body - metrics.wick) / 2;
  const minHollow = metrics.wick * 3;
  let seriesHigh = candles[0].high;
  let seriesLow = candles[0].low;
  for (const candle of candles) {
    if (candle.high > seriesHigh) seriesHigh = candle.high;
    if (candle.low < seriesLow) seriesLow = candle.low;
  }

  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: width * ratio,
          height: height * ratio,
          transformOrigin: 'left top',
          transform: [{ scale: 1 / ratio }, { translateX: -shift.x }, { translateY: -shift.y }],
        }}
      >
        {placed.map((item, index) => {
          const candle = candles[index];
          const color = item.direction === 'up' ? up : item.direction === 'down' ? down : flat;
          const newest = index === placed.length - 1;
          const x = Math.round(item.x * ratio);
          const bodyTop = Math.round(item.bodyTop * ratio);
          const bodyH = Math.round(item.bodyHeight * ratio);
          const hollow =
            item.direction === 'up' && bodyH >= minHollow && metrics.body >= minHollow;
          return (
            <Fragment key={candle.openTime}>
              <DeviceMark
                style={{
                  position: 'absolute',
                  left: x + wickOffset,
                  top: Math.round(item.wickTop * ratio),
                  width: metrics.wick,
                  height: Math.round(item.wickHeight * ratio),
                  backgroundColor: color,
                }}
              />
              <DeviceMark
                testID={newest ? 'candle-last' : undefined}
                style={{
                  position: 'absolute',
                  left: x,
                  top: bodyTop,
                  width: metrics.body,
                  height: bodyH,
                  backgroundColor: color,
                }}
              />
              {hollow ?
                <DeviceMark
                  style={{
                    position: 'absolute',
                    left: x + metrics.wick,
                    top: bodyTop + metrics.wick,
                    width: metrics.body - metrics.wick * 2,
                    height: bodyH - metrics.wick * 2,
                    backgroundColor: surface,
                  }}
                />
              : null}
            </Fragment>
          );
        })}
      </View>
      <View pointerEvents="none" style={[styles.band, styles.bandTop]}>
        <Text role="caption" tone="secondary" style={TABULAR} testID="series-high">
          {formatPrice(seriesHigh, places)}
        </Text>
      </View>
      <View pointerEvents="none" style={[styles.band, styles.bandBottom]}>
        <Text role="caption" tone="secondary" style={TABULAR} testID="series-low">
          {formatPrice(seriesLow, places)}
        </Text>
      </View>
    </>
  );
});

function ReadoutValue({
  label,
  value,
  testID,
  color,
  opacity,
}: {
  label: (typeof LABELS)[number];
  value: string;
  testID: string;
  color?: string;
  opacity: Animated.Value;
}): JSX.Element {
  return (
    <View style={styles.readoutItem}>
      <Text role="caption" tone="secondary" numberOfLines={1}>
        {label}
      </Text>
      <Animated.View style={{ opacity }}>
        <Text
          role="caption"
          numberOfLines={1}
          style={[TABULAR, color ? { color } : null]}
          testID={testID}
        >
          {value}
        </Text>
      </Animated.View>
    </View>
  );
}

function CandleValues({
  symbol,
  candle,
  opacity,
}: {
  symbol: string;
  candle: Candle;
  opacity: Animated.Value;
}): JSX.Element {
  const instrument = useQuery(MarketSymbol, { symbol });
  const { theme } = useTheme();
  const places = instrument?.pricePlaces ?? decimalsOf(candle.close);
  const up = theme.semantic.color.tones.success.solid;
  const down = theme.semantic.color.tones.danger.solid;
  const closeColor = candle.close > candle.open ? up : candle.close < candle.open ? down : undefined;
  const values = [
    ['Open', formatPrice(candle.open, places), 'candle-open', undefined],
    ['High', formatPrice(candle.high, places), 'candle-high', undefined],
    ['Low', formatPrice(candle.low, places), 'candle-low', undefined],
    ['Close', formatPrice(candle.close, places), 'candle-close', closeColor],
  ] as const;
  return (
    <>
      {values.map(([label, value, testID, color]) => (
        <ReadoutValue
          key={label}
          label={label}
          value={value}
          testID={testID}
          color={color}
          opacity={opacity}
        />
      ))}
    </>
  );
}

/** Subscribes only while mounted. The plot reads the published snapshot, never `requested`. */
const LiveSeries = forwardRef(function LiveSeries(
  {
    symbol,
    interval,
    frozen,
    instant,
    onPublish,
  }: {
    symbol: string;
    interval: CandleInterval;
    frozen: readonly Candle[] | null;
    instant: boolean;
    onPublish: (next: Published | null, owner?: Animated.Value) => void;
  },
  ref: Ref<SeriesHandle>,
): null {
  const live = useLive(getCandles, { symbol, interval });
  const [opacity] = useState(() => new Animated.Value(instant ? 1 : 0));
  const motion = useRef({
    from: instant ? 1 : 0,
    to: instant ? 1 : 0,
    start: 0,
    duration: 0,
    ease: easeIn,
  });
  const cancelRef = useRef<(() => void) | null>(null);
  const painted = frozen ?? live;

  const opacityNow = useCallback(() => {
    const current = motion.current;
    if (current.duration <= 0) return current.to;
    const t = Math.min(1, (Date.now() - current.start) / current.duration);
    return current.from + (current.to - current.from) * current.ease(t);
  }, []);

  const fadeTo = useCallback(
    (to: number, duration: number, curve: 'in' | 'out') => {
      cancelRef.current?.();
      const from = opacityNow();
      const ease = curve === 'out' ? easeOut : easeIn;
      motion.current = { from, to, start: Date.now(), duration, ease };
      opacity.setValue(from);
      if (duration <= 0) {
        opacity.setValue(to);
        motion.current = { from: to, to, start: Date.now(), duration: 0, ease };
        cancelRef.current = null;
        return;
      }
      const timer = setTimeout(() => {
        motion.current = { from: to, to, start: Date.now(), duration: 0, ease };
      }, duration);
      let anim: Animated.CompositeAnimation | undefined;
      try {
        anim = Animated.timing(opacity, {
          toValue: to,
          duration,
          easing: ease,
          useNativeDriver: NATIVE_DRIVER,
        });
        anim.start();
      } catch {
        opacity.setValue(to);
      }
      cancelRef.current = () => {
        clearTimeout(timer);
        anim?.stop();
      };
    },
    [opacity, opacityNow],
  );

  useImperativeHandle(ref, () => ({ opacity: opacityNow, fadeTo }), [fadeTo, opacityNow]);

  useLayoutEffect(() => {
    onPublish({ interval, candles: painted, opacity });
    return () => onPublish(null, opacity);
  }, [interval, onPublish, opacity, painted]);

  useEffect(() => () => cancelRef.current?.(), []);
  return null;
});

function mountedInterval(phase: Phase): CandleInterval | null {
  return phase.kind === 'live' || phase.kind === 'in' || phase.kind === 'out' ? phase.interval : null;
}

function ChartFrame({
  symbol,
  requested,
  boot,
  onInterval,
  onHold,
  width,
  height,
  insetTop,
  insetLeft,
}: {
  symbol: string;
  requested: CandleInterval;
  boot: 'fresh' | 'return' | 'switch';
  onInterval: (interval: CandleInterval) => void;
  onHold: (interval: CandleInterval | null) => void;
  width: number;
  height: number;
  insetTop: number;
  insetLeft: number;
}): JSX.Element {
  const controller = useController();
  const reduce = useReduceMotion();
  const bootKind = useRef(boot).current;
  const readyAtStart = useRef(
    bootKind !== 'switch' &&
      cachedListReady(
        readList(controller, symbol, requested).meta,
        readList(controller, symbol, requested).candles,
        Date.now(),
        requested,
      ),
  ).current;

  const [phase, setPhase] = useState<Phase>(() => {
    if (bootKind === 'fresh') return { kind: 'live', interval: requested };
    if (!readyAtStart) return { kind: 'empty' };
    return { kind: 'in', interval: requested };
  });
  const [published, setPublished] = useState<Published | null>(null);
  const [caption, setCaption] = useState(false);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const requestedRef = useRef(requested);
  requestedRef.current = requested;
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;
  const seriesRef = useRef<SeriesHandle>(null);
  const candlesRef = useRef<readonly Candle[] | null>(null);
  const frozenRef = useRef<readonly Candle[] | null>(null);
  const acceptedRef = useRef<CandleInterval | null>(null);
  const failedRef = useRef<CandleInterval | null>(null);
  const revealedRef = useRef<CandleInterval | null>(null);
  const wait = useRef({
    startedAt: null as number | null,
    generation: 0,
    caption: undefined as ReturnType<typeof setTimeout> | undefined,
    reveal: undefined as ReturnType<typeof setTimeout> | undefined,
    ceiling: undefined as ReturnType<typeof setTimeout> | undefined,
    fade: undefined as ReturnType<typeof setTimeout> | undefined,
    settle: undefined as ReturnType<typeof setTimeout> | undefined,
  });

  const publish = useCallback((next: Published | null, owner?: Animated.Value) => {
    setPublished(current => {
      if (next == null) {
        return owner && current?.opacity === owner ? null : current;
      }
      if (
        current &&
        current.candles === next.candles &&
        current.opacity === next.opacity &&
        current.interval === next.interval
      ) {
        return current;
      }
      candlesRef.current = next.candles;
      return next;
    });
  }, []);

  const clearTimers = useCallback((invalidateFetch: boolean) => {
    const timers = wait.current;
    if (invalidateFetch) timers.generation += 1;
    timers.startedAt = null;
    clearTimeout(timers.caption);
    clearTimeout(timers.reveal);
    clearTimeout(timers.ceiling);
    clearTimeout(timers.fade);
  }, []);

  const canShow = useCallback(
    (interval: CandleInterval) => {
      if (acceptedRef.current === interval) return true;
      const { exists, meta, candles } = readList(controllerRef.current, symbol, interval);
      if (!exists) return false;
      return cachedListReady(meta, candles, Date.now(), interval);
    },
    [symbol],
  );

  const mountSeries = useCallback((interval: CandleInterval) => {
    if (requestedRef.current !== interval || !canShow(interval)) return false;
    failedRef.current = null;
    frozenRef.current = null;
    wait.current.startedAt = null;
    clearTimeout(wait.current.caption);
    clearTimeout(wait.current.reveal);
    onHoldRef.current(null);
    if (reduceRef.current) {
      setCaption(false);
      setPhase({ kind: 'live', interval });
      return true;
    }
    setPhase({ kind: 'in', interval });
    return true;
  }, [canShow]);

  const scheduleReveal = useCallback(
    (interval: CandleInterval) => {
      if (phaseRef.current.kind === 'out') return;
      const at = revealAt(wait.current.startedAt, Date.now(), Date.now());
      const delay = at - Date.now();
      clearTimeout(wait.current.reveal);
      if (delay <= 0) return mountSeries(interval);
      wait.current.reveal = setTimeout(() => mountSeries(interval), delay);
      return false;
    },
    [mountSeries],
  );

  const showFailure = useCallback((interval: CandleInterval) => {
    failedRef.current = interval;
    if (phaseRef.current.kind === 'out') return;
    if (requestedRef.current !== interval) return;
    wait.current.startedAt = null;
    clearTimeout(wait.current.caption);
    clearTimeout(wait.current.reveal);
    setCaption(false);
    onHoldRef.current(null);
    setPhase({ kind: 'fail' });
  }, []);

  const beginFetch = useCallback(
    (interval: CandleInterval) => {
      const generation = ++wait.current.generation;
      clearTimeout(wait.current.ceiling);
      wait.current.ceiling = setTimeout(() => {
        if (wait.current.generation !== generation) return;
        showFailure(interval);
      }, FAILURE_MS);
      const promise = controllerRef.current.fetch(getCandles, { symbol, interval });
      promise.then(
        () => {
          if (wait.current.generation !== generation) return;
          clearTimeout(wait.current.ceiling);
          acceptedRef.current = interval;
          if (failedRef.current === interval) failedRef.current = null;
          scheduleReveal(interval);
        },
        () => {
          if (wait.current.generation !== generation) return;
          showFailure(interval);
        },
      );
    },
    [scheduleReveal, showFailure, symbol],
  );

  const ensureWait = useCallback(() => {
    if (wait.current.startedAt != null) return;
    wait.current.startedAt = Date.now();
    clearTimeout(wait.current.caption);
    wait.current.caption = setTimeout(() => {
      if (wait.current.startedAt == null) return;
      setCaption(true);
    }, CAPTION_DELAY_MS);
  }, []);

  const onFadeDone = useCallback(() => {
    const next = requestedRef.current;
    onHoldRef.current(null);
    // The fade has finished. phaseRef still says `out` until the next render,
    // and reveal/failure both refuse to run while it does.
    if (phaseRef.current.kind === 'out') phaseRef.current = { kind: 'empty' };
    if (failedRef.current === next) {
      showFailure(next);
      return;
    }
    if (canShow(next) && scheduleReveal(next)) return;
    setPhase({ kind: 'empty' });
  }, [canShow, scheduleReveal, showFailure]);

  const fadeOut = useCallback(
    (interval: CandleInterval) => {
      frozenRef.current = candlesRef.current;
      const from = seriesRef.current?.opacity() ?? 1;
      setPhase({ kind: 'out', interval });
      const duration = FADE_OUT_MS * from;
      seriesRef.current?.fadeTo(0, duration, 'out');
      clearTimeout(wait.current.fade);
      wait.current.fade = setTimeout(onFadeDone, duration);
    },
    [onFadeDone],
  );

  const onSelect = useCallback(
    (next: CandleInterval) => {
      const current = phaseRef.current;
      if (next === requestedRef.current && current.kind !== 'fail') return;
      const mounted = mountedInterval(current);
      const tapBack = mounted != null && next === mounted && current.kind === 'out';

      if (acceptedRef.current !== next) acceptedRef.current = null;
      requestedRef.current = next;
      onInterval(next);

      if (tapBack) {
        clearTimers(true);
        failedRef.current = null;
        frozenRef.current = null;
        setCaption(false);
        onHoldRef.current(null);
        setPhase({ kind: 'live', interval: next });
        const from = seriesRef.current?.opacity() ?? 0;
        const duration = reduceRef.current ? 0 : FADE_IN_MS * (1 - from);
        seriesRef.current?.fadeTo(1, duration, 'in');
        return;
      }

      const ready = canShow(next);
      const cut = reduceRef.current && ready;
      if (cut) {
        clearTimers(false);
        failedRef.current = null;
        frozenRef.current = null;
        setCaption(false);
        onHoldRef.current(null);
        setPhase({ kind: 'live', interval: next });
        return;
      }

      if (reduceRef.current && !ready) {
        clearTimers(false);
        failedRef.current = null;
        frozenRef.current = null;
        setCaption(false);
        onHoldRef.current(null);
        setPhase({ kind: 'empty' });
        ensureWait();
        beginFetch(next);
        return;
      }

      failedRef.current = null;
      if (mounted != null && current.kind !== 'fail') {
        onHoldRef.current(mounted === next ? null : mounted);
        if (current.kind !== 'out') fadeOut(mounted);
      } else {
        onHoldRef.current(null);
        if (!ready) setPhase({ kind: 'empty' });
      }

      if (!ready) {
        ensureWait();
        beginFetch(next);
      } else if (mounted == null || current.kind === 'fail') {
        scheduleReveal(next);
      }
    },
    [beginFetch, canShow, clearTimers, ensureWait, fadeOut, onInterval, scheduleReveal],
  );

  const onLayout = useCallback(() => {
    const current = phaseRef.current;
    if (current.kind !== 'in') return;
    if (revealedRef.current === current.interval) return;
    revealedRef.current = current.interval;
    setCaption(false);
    const duration = reduceRef.current ? 0 : FADE_IN_MS;
    seriesRef.current?.fadeTo(1, duration, 'in');
    clearTimeout(wait.current.settle);
    wait.current.settle = setTimeout(() => {
      const latest = phaseRef.current;
      if (latest.kind === 'in' && latest.interval === current.interval) {
        setPhase({ kind: 'live', interval: current.interval });
      }
    }, duration);
  }, []);

  useEffect(() => {
    if (phaseRef.current.kind !== 'empty') return;
    const interval = requestedRef.current;
    if (canShow(interval)) scheduleReveal(interval);
    else {
      ensureWait();
      beginFetch(interval);
    }
    // The empty frame's first fetch is the mount, not a later tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      clearTimers(true);
      clearTimeout(wait.current.settle);
      onHoldRef.current(null);
    },
    [clearTimers],
  );

  const mounted = mountedInterval(phase);
  const hidden = phase.kind === 'out';
  const showValues = published != null && published.candles.length > 0 && published.interval === mounted;
  const showEmpty = published != null && published.candles.length === 0 && published.interval === mounted;

  return (
    <View style={styles.frame}>
      <IntervalChips value={requested} onSelect={onSelect} />
      {mounted ?
        <LiveSeries
          key={mounted}
          ref={seriesRef}
          symbol={symbol}
          interval={mounted}
          frozen={phase.kind === 'out' ? frozenRef.current : null}
          instant={phase.kind === 'live'}
          onPublish={publish}
        />
      : null}
      <View testID="candles" style={[styles.plot, { width, height }]}>
        {showValues && published ?
          <Animated.View
            testID={`candle-series-${published.interval}`}
            accessible
            accessibilityLabel={`${symbol} ${intervalLabel(published.interval)} candles`}
            accessibilityElementsHidden={hidden}
            importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
            needsOffscreenAlphaCompositing
            onLayout={onLayout}
            style={{ width, height, overflow: 'hidden', opacity: published.opacity }}
          >
            <CandlePlot
              symbol={symbol}
              interval={published.interval}
              candles={published.candles}
              width={width}
              height={height}
              insetTop={insetTop}
              insetLeft={insetLeft}
            />
          </Animated.View>
        : null}
        {caption ?
          <View pointerEvents="none" style={[styles.band, styles.bandTop, styles.captionBand]}>
            <Text
              role="caption"
              tone="secondary"
              style={TABULAR}
              accessibilityLiveRegion="polite"
              testID="chart-caption"
            >
              Loading {intervalLabel(requested)} candles
            </Text>
          </View>
        : null}
      </View>
      <View testID="candle-readout" style={styles.readout}>
        {showValues && published ?
          <CandleValues symbol={symbol} candle={published.candles[published.candles.length - 1]} opacity={published.opacity} />
        : LABELS.map(label => (
            <View key={label} style={styles.readoutItem}>
              <Text role="caption" tone="secondary" numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
      </View>
      {showEmpty && published ?
        <Animated.View
          testID={`candle-series-${published.interval}`}
          onLayout={onLayout}
          accessibilityElementsHidden={hidden}
          importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
          style={[styles.emptySeries, { opacity: published.opacity }]}
        >
          <Text tone="secondary" testID="chart-empty" style={styles.message}>
            No candles yet
          </Text>
        </Animated.View>
      : null}
      {phase.kind === 'fail' ?
        <View style={styles.failure} pointerEvents="box-none">
          <LoadError
            what={`${symbol} ${intervalLabel(requested)} candles`}
            onRetry={() => onSelect(requestedRef.current)}
          />
        </View>
      : null}
    </View>
  );
}

function Gate({
  symbol,
  interval,
  onOpen,
}: {
  symbol: string;
  interval: CandleInterval;
  onOpen: () => void;
}): null {
  useLive(getCandles, { symbol, interval });
  useLayoutEffect(() => {
    onOpen();
  }, [onOpen]);
  return null;
}

export default function ChartBody({
  symbol,
  interval,
  onInterval,
  onRetry,
  retry,
  onHold,
}: {
  symbol: string;
  interval: CandleInterval;
  onInterval: (interval: CandleInterval) => void;
  onRetry: () => void;
  retry: number;
  onHold?: (interval: CandleInterval | null) => void;
}): JSX.Element {
  const controller = useController();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const plot = plotSize(width, height, insets.top, insets.bottom);
  const openedAt = useRef(interval).current;
  const hadList = useRef(listExists(controller, symbol, openedAt)).current;
  const [pastGate, setPastGate] = useState(hadList);
  const openGate = useCallback(() => setPastGate(true), []);
  const hold = useCallback(
    (next: CandleInterval | null) => {
      onHold?.(next);
    },
    [onHold],
  );
  const showGate = !pastGate && interval === openedAt;
  const boot = hadList ? 'return' : interval === openedAt ? 'fresh' : 'switch';

  return (
    <View style={styles.body}>
      {showGate ?
        <>
          <IntervalChips value={interval} onSelect={onInterval} />
          <AsyncBoundary
            key={retry}
            fallback={
              <Text tone="secondary" testID="chart-loading" style={styles.message}>
                Loading {symbol}
              </Text>
            }
            errorComponent={() => <LoadError what={`${symbol} candles`} onRetry={onRetry} />}
          >
            <Gate symbol={symbol} interval={openedAt} onOpen={openGate} />
          </AsyncBoundary>
        </>
      : <ChartFrame
          symbol={symbol}
          requested={interval}
          boot={boot}
          onInterval={onInterval}
          onHold={hold}
          width={plot.width}
          height={plot.height}
          insetTop={insets.top}
          insetLeft={insets.left}
        />
      }
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  frame: {
    flex: 1,
    position: 'relative',
  },
  chips: {
    height: INTERVAL_ROW,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PLOT_MARGIN,
    gap: 8,
  },
  plot: {
    marginHorizontal: PLOT_MARGIN,
    position: 'relative',
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: PLOT_PAD,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  bandTop: {
    top: 0,
  },
  bandBottom: {
    bottom: 0,
  },
  captionBand: {
    alignItems: 'flex-start',
  },
  message: {
    paddingHorizontal: PLOT_MARGIN,
    paddingTop: PLOT_MARGIN,
  },
  readout: {
    height: READOUT,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PLOT_MARGIN,
  },
  readoutItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  emptySeries: {
    position: 'absolute',
    top: INTERVAL_ROW,
    left: 0,
    right: 0,
  },
  failure: {
    position: 'absolute',
    top: INTERVAL_ROW,
    left: 0,
    right: 0,
  },
});
