import { AsyncBoundary, useCache, useController, useLive, useQuery } from '@data-client/react';
import { Text, useTheme } from '@reactive/silk-native';
import {
  forwardRef,
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
  type GestureResponderEvent,
  type PointerEvent,
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
  periodStart,
  revealAt,
} from '@/components/chartMotion';
import {
  labelStops,
  placeCandles,
  planTravel,
  rowFetchOrder,
  travelSpring,
  type PriceDomain,
  type StepId,
  type StepPlan,
  type TravelCandle,
  type TravelPlan,
} from '@/components/chartTravel';
import { LoadError } from '@/components/LoadError';
import { Pill } from '@/components/Pill';
import {
  candleIndexAt,
  candleLayout,
  candleMetrics,
  type CandleDirection,
  INTERVAL_ROW,
  PLOT_MARGIN,
  PLOT_PAD,
  plotDeviceShift,
  plotSize,
  READOUT,
} from '@/components/candleLayout';
import { decimalsOf, directionWord, formatCandleTime, formatPrice } from '@/components/formatMarket';
import { Candle, getCandles, INTERVALS, type CandleInterval } from '@/resources/Candle';
import { MarketSymbol } from '@/resources/Symbol';

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };
// Jest's native animated mock ends the spring in 16ms without moving `p`.
// The device still uses the native driver; web and tests run the same JS graph.
const NATIVE_DRIVER = Platform.OS !== 'web' && process.env.JEST_WORKER_ID == null;
// JavaScript springs timestamp independently, so web and Jest share one clock.
const SHARE_CLOCK = !NATIVE_DRIVER;
const LABELS = ['Open', 'High', 'Low', 'Close'] as const;

type Phase =
  | { kind: 'live' | 'in' | 'out'; interval: CandleInterval }
  | { kind: 'empty' }
  | { kind: 'fail' }
  | { kind: 'travel' | 'travel-out'; session: Session };

type Published = {
  interval: CandleInterval;
  candles: readonly Candle[];
  opacity: Animated.Value;
};

type SeriesHandle = {
  opacity: () => number;
  fadeTo: (to: number, duration: number, curve: 'in' | 'out') => void;
  /** The value created for this mount. A remount gets a new one. */
  value: Animated.Value;
};

type Axis = Animated.AnimatedInterpolation<number>;
type Shift = ReturnType<typeof Animated.subtract>;

type PlotMotion = {
  scaleX: Axis;
  translateX: Axis;
  scaleY: Axis;
  translateY: Axis;
  layerOpacity?: Axis;
  shifts?: ReadonlyMap<number, Shift>;
  covered?: ReadonlySet<number>;
  coveredOpacity?: Axis;
  labelOpacity?: Axis;
};

type StepGraph = {
  progress: Animated.Value;
  readoutOpacity: Axis;
  shifts: Map<number, Shift>;
  motion: PlotMotion;
};

type Session = {
  plan: TravelPlan;
  origin: readonly Candle[];
  steps: StepGraph[];
  clock: Animated.Value | null;
  reverse: boolean;
  timers: ReturnType<typeof setTimeout>[];
};

function opacityOf(progress: Animated.Value, stops: { input: number[]; output: number[] }): Axis {
  return progress.interpolate({
    inputRange: stops.input,
    outputRange: stops.output,
    extrapolate: 'clamp',
  });
}

function attachShifts(graph: StepGraph, step: StepPlan) {
  if (!step.perCandle || graph.shifts.size > 0) return;
  for (const [openTime, output] of step.shifts) {
    const raw = graph.progress.interpolate({
      inputRange: step.input,
      outputRange: output,
      extrapolate: 'clamp',
    });
    graph.shifts.set(openTime, Animated.subtract(raw, Animated.modulo(raw, 1)));
  }
}

function buildSession(plan: TravelPlan, origin: readonly Candle[]): Session {
  const clock = SHARE_CLOCK ? new Animated.Value(0) : null;
  const steps = plan.steps.map(step => {
    const progress = clock ?? new Animated.Value(0);
    const range = { inputRange: step.input, extrapolate: 'clamp' as const };
    const shifts = new Map<number, Shift>();
    const graph: StepGraph = {
      progress,
      readoutOpacity: opacityOf(progress, step.readout),
      shifts,
      motion: {
        scaleX: progress.interpolate({ ...range, outputRange: step.scaleX }),
        translateX: progress.interpolate({ ...range, outputRange: step.translateX }),
        scaleY: progress.interpolate({ ...range, outputRange: step.scaleY }),
        translateY: progress.interpolate({ ...range, outputRange: step.translateY }),
        layerOpacity: opacityOf(progress, step.layer),
        shifts,
        covered: step.split ? step.covered : undefined,
        coveredOpacity: step.coveredStops ? opacityOf(progress, step.coveredStops) : undefined,
      },
    };
    if (step.mountAt <= 0) attachShifts(graph, step);
    return graph;
  });
  const labelClock = clock ?? steps[steps.length - 1].progress;
  const labelOpacity = opacityOf(labelClock, labelStops(plan));
  for (const [index, graph] of steps.entries()) {
    if (plan.steps[index].interval === plan.to) graph.motion.labelOpacity = labelOpacity;
  }
  return {
    plan,
    origin,
    steps,
    clock,
    reverse: false,
    timers: [],
  };
}

function runSpring(
  progress: Animated.Value,
  toValue: number,
  duration: number,
  threshold: number,
  onEnd: (finished: boolean) => void,
) {
  try {
    Animated.spring(progress, {
      toValue,
      velocity: 0,
      ...travelSpring(duration, threshold),
      useNativeDriver: NATIVE_DRIVER,
    }).start(({ finished }) => onEnd(finished));
  } catch {
    progress.setValue(toValue);
    onEnd(true);
  }
}

function startClocks(session: Session, toValue: number, onEnd: (finished: boolean) => void) {
  const { plan } = session;
  if (session.clock) {
    const threshold = toValue === 0 ? 0.0001 : 0.01;
    runSpring(session.clock, toValue, plan.duration, threshold, onEnd);
    return;
  }
  const driver = toValue === 0 ? 0 : plan.steps.length - 1;
  session.steps.forEach((graph, index) => {
    const step = plan.steps[index];
    const threshold = toValue === 0 ? step.reverseThreshold : step.forwardThreshold;
    runSpring(graph.progress, toValue, plan.duration, threshold, finished => {
      if (index === driver) onEnd(finished);
    });
  });
}

function stopClocks(session: Session | null, onTarget: (value: number) => void) {
  if (!session) return;
  if (session.clock) {
    session.clock.stopAnimation(value => onTarget(typeof value === 'number' ? value : 0));
    return;
  }
  const target = session.steps[session.steps.length - 1].progress;
  for (const graph of session.steps) {
    if (graph.progress === target) {
      graph.progress.stopAnimation(value => onTarget(typeof value === 'number' ? value : 0));
    } else {
      graph.progress.stopAnimation();
    }
  }
}

function clearStaging(session: Session | null) {
  if (!session) return;
  for (const timer of session.timers) clearTimeout(timer);
  session.timers = [];
}

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

function snapshotCandles(candles: readonly Candle[]): Candle[] {
  return candles.map(candle => Object.assign(new Candle(), candle));
}

function storedLists(
  controller: ReturnType<typeof useController>,
  symbol: string,
): Partial<Record<StepId, { candles: Candle[]; error?: boolean }>> {
  const stored: Partial<Record<StepId, { candles: Candle[]; error?: boolean }>> = {};
  for (const item of INTERVALS) {
    const { exists, meta, candles } = readList(controller, symbol, item.value);
    if (!exists || !candles) continue;
    stored[item.value] = { candles, error: meta?.error != null };
  }
  return stored;
}

function travelAttempt(
  controller: ReturnType<typeof useController>,
  symbol: string,
  from: CandleInterval,
  to: CandleInterval,
  origin: readonly Candle[],
  target: readonly Candle[],
  elapsedMs: number,
  width: number,
  height: number,
  targetReady: boolean,
  now = Date.now(),
) {
  return planTravel({
    from,
    to,
    origin,
    target,
    now,
    reduceMotion: false,
    atRest: true,
    originReady: origin.length > 0 && origin[origin.length - 1].openTime >= periodStart(now, from),
    targetReady,
    elapsedMs,
    width,
    height,
    ratio: PixelRatio.get(),
    stored: storedLists(controller, symbol),
  });
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
  onWarm,
}: {
  value: CandleInterval;
  onSelect: (interval: CandleInterval) => void;
  onWarm?: (interval: CandleInterval) => void;
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
            onPressIn={onWarm ? () => onWarm(item.value) : undefined}
          />
        );
      })}
    </View>
  );
}

export type ScrubQuote = {
  open: number;
  close: number;
  openTime: number;
  interval: CandleInterval;
};

function pointerX(event: PointerEvent): number | null {
  const native = event.nativeEvent as PointerEvent['nativeEvent'] & { locationX?: number };
  const primary = Platform.OS === 'web' ? native.offsetX : native.locationX;
  const fallback = Platform.OS === 'web' ? native.locationX : native.offsetX;
  if (typeof primary === 'number' && Number.isFinite(primary)) return primary;
  if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
  return null;
}

function closeY(item: { direction: CandleDirection; bodyTop: number; bodyHeight: number }): number {
  return item.direction === 'down' ? item.bodyTop + item.bodyHeight : item.bodyTop;
}

const SCRUB_LABEL = 36;

function ScrubGuides({
  centre,
  close,
  height,
  ratio,
  metrics,
  direction,
  up,
  down,
  flat,
  surface,
}: {
  centre: number;
  close: number;
  height: number;
  ratio: number;
  metrics: ReturnType<typeof candleMetrics>;
  direction: CandleDirection;
  up: string;
  down: string;
  flat: string;
  surface: string;
}): JSX.Element {
  const lineW = metrics.wick;
  const band = Math.round(PLOT_PAD * ratio);
  const color = direction === 'up' ? up : direction === 'down' ? down : flat;
  const markW = metrics.body;
  const markH = direction === 'flat' ? lineW : metrics.body;
  return (
    <>
      <DeviceMark
        testID="scrub-line"
        style={{
          position: 'absolute',
          left: centre - Math.floor(lineW / 2),
          top: band,
          width: lineW,
          height: Math.max(lineW, Math.round(height * ratio) - band * 2),
          backgroundColor: flat,
        }}
      />
      <DeviceMark
        testID="scrub-mark"
        style={{
          position: 'absolute',
          left: centre - Math.floor(markW / 2),
          top: close - Math.floor(markH / 2),
          width: markW,
          height: markH,
          backgroundColor: direction === 'up' ? surface : color,
          borderWidth: direction === 'up' ? lineW : 0,
          borderColor: color,
        }}
      />
    </>
  );
}

function ScrubLabel({
  centreX,
  anchorY,
  width,
  height,
  price,
  when,
  word,
  surface,
}: {
  centreX: number;
  anchorY: number;
  width: number;
  height: number;
  price: string;
  when: string;
  word: 'Up' | 'Down' | 'Flat';
  surface: string;
}): JSX.Element {
  const gap = 8;
  const onRight = centreX <= width / 2;
  const minTop = PLOT_PAD;
  const maxTop = Math.max(minTop, height - PLOT_PAD - SCRUB_LABEL);
  const top = Math.min(Math.max(anchorY - SCRUB_LABEL / 2, minTop), maxTop);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.scrubLabel,
        {
          top,
          backgroundColor: surface,
          maxWidth: Math.max(48, onRight ? width - centreX - gap : centreX - gap),
          alignItems: onRight ? 'flex-start' : 'flex-end',
          left: onRight ? centreX + gap : undefined,
          right: onRight ? undefined : width - centreX + gap,
        },
      ]}
    >
      <Text
        role="caption"
        numberOfLines={1}
        style={TABULAR}
        testID="scrub-price"
        accessibilityLabel={`${word} ${price}`}
      >
        {price}
      </Text>
      <Text role="caption" tone="secondary" numberOfLines={1} style={TABULAR} testID="scrub-time">
        {word} {when}
      </Text>
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
  motion,
  domain = null,
  showLabels = true,
  scrubIndex = null,
}: {
  symbol: string;
  interval: StepId;
  candles: readonly TravelCandle[];
  width: number;
  height: number;
  insetTop: number;
  insetLeft: number;
  motion?: PlotMotion;
  domain?: PriceDomain | null;
  showLabels?: boolean;
  scrubIndex?: number | null;
}): JSX.Element {
  const instrument = useQuery(MarketSymbol, { symbol });
  const { theme } = useTheme();
  const ratio = PixelRatio.get();
  const metrics = candleMetrics(width, ratio);
  const placed = domain ? placeCandles(candles, { width, height, ratio }, domain) : candleLayout(candles, { width, height, ratio });
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
  const labelStyle = motion?.labelOpacity ? { opacity: motion.labelOpacity } : undefined;
  const scrubbed = scrubIndex != null ? placed[scrubIndex] : undefined;
  const scrubCandle = scrubbed && scrubIndex != null ? candles[scrubIndex] : undefined;

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={{
          width,
          height,
          opacity: motion?.layerOpacity,
          transform: motion
            ? [
                { translateX: motion.translateX },
                { translateY: motion.translateY },
                { scaleX: motion.scaleX },
                { scaleY: motion.scaleY },
              ]
            : undefined,
        }}
      >
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
            const bodyLeft = Math.round(item.x * ratio);
            const slotLeft = bodyLeft - metrics.gap;
            const bodyTop = Math.round(item.bodyTop * ratio);
            const bodyH = Math.round(item.bodyHeight * ratio);
            const hollow =
              item.direction === 'up' && bodyH >= minHollow && metrics.body >= minHollow;
            const tx = motion?.shifts?.get(candle.openTime);
            const covered = motion?.covered?.has(candle.openTime) === true;
            return (
              <Animated.View
                key={candle.openTime}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: slotLeft,
                  top: 0,
                  width: metrics.slot,
                  height: height * ratio,
                  opacity: covered ? motion?.coveredOpacity : 1,
                  transform: tx ? [{ translateX: tx }] : undefined,
                }}
              >
                <DeviceMark
                  style={{
                    position: 'absolute',
                    left: metrics.gap + wickOffset,
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
                    left: metrics.gap,
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
                      left: metrics.gap + metrics.wick,
                      top: bodyTop + metrics.wick,
                      width: metrics.body - metrics.wick * 2,
                      height: bodyH - metrics.wick * 2,
                      backgroundColor: surface,
                    }}
                  />
                : null}
              </Animated.View>
            );
          })}
          {scrubbed && scrubCandle ?
            <ScrubGuides
              centre={Math.round(scrubbed.x * ratio + metrics.body / 2)}
              close={Math.round(closeY(scrubbed) * ratio)}
              height={height}
              ratio={ratio}
              metrics={metrics}
              direction={scrubbed.direction}
              up={up}
              down={down}
              flat={flat}
              surface={surface}
            />
          : null}
        </View>
      </Animated.View>
      {showLabels ?
        <>
          <View pointerEvents="none" style={[styles.band, styles.bandTop]}>
            <Animated.View style={labelStyle}>
              <Text role="caption" tone="secondary" style={TABULAR} testID="series-high">
                {formatPrice(seriesHigh, places)}
              </Text>
            </Animated.View>
          </View>
          <View pointerEvents="none" style={[styles.band, styles.bandBottom]}>
            <Animated.View style={labelStyle}>
              <Text role="caption" tone="secondary" style={TABULAR} testID="series-low">
                {formatPrice(seriesLow, places)}
              </Text>
            </Animated.View>
          </View>
        </>
      : null}
      {scrubbed && scrubCandle ?
        <ScrubLabel
          centreX={scrubbed.x + metrics.bodyCss / 2}
          anchorY={closeY(scrubbed)}
          width={width}
          height={height}
          price={formatPrice(scrubCandle.close, places)}
          when={formatCandleTime(scrubCandle.openTime, interval)}
          word={directionWord(scrubCandle.open, scrubCandle.close)}
          surface={surface}
        />
      : null}
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

function TravelReadout({ symbol, session }: { symbol: string; session: Session }): JSX.Element {
  const instrument = useQuery(MarketSymbol, { symbol });
  const { theme } = useTheme();
  const last = session.plan.steps[session.plan.steps.length - 1].candles.at(-1);
  const places = instrument?.pricePlaces ?? decimalsOf(last?.close ?? 0);
  const up = theme.semantic.color.tones.success.solid;
  const down = theme.semantic.color.tones.danger.solid;
  const tone = (candle: TravelCandle) =>
    candle.close > candle.open ? up : candle.close < candle.open ? down : undefined;
  const price = (candle: TravelCandle, label: (typeof LABELS)[number]) =>
    label === 'Open' ? candle.open
    : label === 'High' ? candle.high
    : label === 'Low' ? candle.low
    : candle.close;
  return (
    <>
      {LABELS.map(label => {
        const testID = `candle-${label.toLowerCase()}`;
        const colored = label === 'Close';
        return (
          <View key={label} style={styles.readoutItem}>
            <Text role="caption" tone="secondary" numberOfLines={1}>
              {label}
            </Text>
            <View>
              {session.plan.steps.map((step, index) => {
                const candle = step.candles[step.candles.length - 1];
                if (!candle) return null;
                return (
                  <Animated.View
                    key={step.interval}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                      index === 0 ? null : styles.readoutLayer,
                      { opacity: session.steps[index].readoutOpacity },
                    ]}
                  >
                    <Text
                      role="caption"
                      numberOfLines={1}
                      style={[TABULAR, colored && tone(candle) ? { color: tone(candle) } : null]}
                      testID={testID}
                    >
                      {formatPrice(price(candle, label), places)}
                    </Text>
                  </Animated.View>
                );
              })}
            </View>
          </View>
        );
      })}
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

  useImperativeHandle(
    ref,
    () => ({ opacity: opacityNow, fadeTo, value: opacity }),
    [fadeTo, opacity, opacityNow],
  );

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
  onScrub,
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
  onScrub?: (quote: ScrubQuote | null) => void;
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

  const [shown, setShown] = useState<readonly number[]>([]);
  const [phase, setPhase] = useState<Phase>(() => {
    if (bootKind === 'fresh') return { kind: 'live', interval: requested };
    if (!readyAtStart) return { kind: 'empty' };
    return { kind: 'in', interval: requested };
  });
  const [published, setPublished] = useState<Published | null>(null);
  const [caption, setCaption] = useState(false);
  const [pinned, setPinned] = useState<readonly Candle[] | null>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const shell = useRef(new Animated.Value(1)).current;

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
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const finger = useRef(false);
  const seriesRef = useRef<SeriesHandle>(null);
  const candlesRef = useRef<readonly Candle[] | null>(null);
  const frozenRef = useRef<readonly Candle[] | null>(null);
  const acceptedRef = useRef<CandleInterval | null>(null);
  const failedRef = useRef<CandleInterval | null>(null);
  const revealedRef = useRef<Animated.Value | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const travelToken = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;
  const wait = useRef({
    startedAt: null as number | null,
    generation: 0,
    caption: undefined as ReturnType<typeof setTimeout> | undefined,
    reveal: undefined as ReturnType<typeof setTimeout> | undefined,
    ceiling: undefined as ReturnType<typeof setTimeout> | undefined,
    fade: undefined as ReturnType<typeof setTimeout> | undefined,
    settle: undefined as ReturnType<typeof setTimeout> | undefined,
    travel: undefined as ReturnType<typeof setTimeout> | undefined,
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
    clearTimeout(timers.travel);
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
    sessionRef.current = null;
    setPinned(null);
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
      // A fetch the user already left must not clear the reveal that replaced it.
      if (requestedRef.current !== interval) return false;
      const kind = phaseRef.current.kind;
      if (kind === 'out' || kind === 'travel' || kind === 'travel-out') return;
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
    const kind = phaseRef.current.kind;
    if (kind === 'out' || kind === 'travel' || kind === 'travel-out') return;
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

  const finishTravel = useCallback((interval: CandleInterval) => {
    clearStaging(sessionRef.current);
    sessionRef.current = null;
    setShown([]);
    setPinned(null);
    frozenRef.current = null;
    onHoldRef.current(null);
    setCaption(false);
    setPhase({ kind: 'live', interval });
  }, []);

  const stageSession = useCallback((session: Session) => {
    const initial = session.plan.steps.flatMap((step, index) => (step.mountAt <= 0 ? [index] : []));
    setShown(initial);
    session.plan.steps.forEach((step, index) => {
      if (step.mountAt <= 0) return;
      const timer = setTimeout(() => {
        if (sessionRef.current !== session) return;
        attachShifts(session.steps[index], step);
        setShown(current => (current.includes(index) ? current : [...current, index]));
      }, step.mountAt);
      session.timers.push(timer);
    });
  }, []);

  const onWarm = useCallback(
    (interval: CandleInterval) => {
      if (interval === requestedRef.current && phaseRef.current.kind !== 'fail') return;
      if (canShow(interval)) return;
      void Promise.resolve(controllerRef.current.fetch(getCandles, { symbol, interval })).then(
        () => {
          acceptedRef.current = interval;
          if (requestedRef.current !== interval) return;
          const kind = phaseRef.current.kind;
          if (kind === 'out' || kind === 'travel' || kind === 'travel-out') return;
          clearTimeout(wait.current.ceiling);
          if (failedRef.current === interval) failedRef.current = null;
          scheduleReveal(interval);
        },
        () => {},
      );
    },
    [canShow, scheduleReveal, symbol],
  );

  const onSelect = useCallback(
    (next: CandleInterval) => {
      const current = phaseRef.current;
      if (next === requestedRef.current && current.kind !== 'fail') return;
      travelToken.current += 1;
      clearTimeout(wait.current.travel);
      setPinned(null);
      const mounted = mountedInterval(current);
      const tapBack = mounted != null && next === mounted && current.kind === 'out';

      if (acceptedRef.current !== next) acceptedRef.current = null;
      requestedRef.current = next;
      onInterval(next);

      if (current.kind === 'travel') {
        const session = current.session;
        if (next === session.plan.from) {
          session.reverse = true;
          clearStaging(session);
          onHoldRef.current(null);
          stopClocks(session, value => {
            if (session.clock) session.clock.setValue(value);
            else for (const graph of session.steps) graph.progress.setValue(value);
            startClocks(session, 0, finished => {
              if (!finished || !session.reverse || phaseRef.current.kind !== 'travel') return;
              finishTravel(session.plan.from);
            });
          });
          return;
        }
        session.reverse = false;
        clearStaging(session);
        stopClocks(session, () => {});
        setPhase({ kind: 'travel-out', session });
        shell.setValue(1);
        try {
          Animated.timing(shell, {
            toValue: 0,
            duration: FADE_OUT_MS,
            easing: easeOut,
            useNativeDriver: NATIVE_DRIVER,
          }).start();
        } catch {
          shell.setValue(0);
        }
        clearTimeout(wait.current.fade);
        wait.current.fade = setTimeout(() => {
          if (phaseRef.current.kind !== 'travel-out') return;
          sessionRef.current = null;
          setPinned(null);
          phaseRef.current = { kind: 'empty' };
          onFadeDone();
        }, FADE_OUT_MS);
        if (!canShow(next)) {
          ensureWait();
          beginFetch(next);
        }
        return;
      }

      if (current.kind === 'travel-out') {
        if (next === current.session.plan.from) {
          clearTimers(true);
          sessionRef.current = null;
          shell.setValue(1);
          failedRef.current = null;
          frozenRef.current = null;
          setCaption(false);
          onHoldRef.current(null);
          setPhase({ kind: 'live', interval: next });
          return;
        }
        if (!canShow(next)) {
          ensureWait();
          beginFetch(next);
        }
        return;
      }

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

      if (current.kind === 'live' && ready && mounted) {
        const liveOrigin = candlesRef.current;
        const stored = readList(controllerRef.current, symbol, next).candles;
        if (liveOrigin && stored && liveOrigin.length > 0 && stored.length > 0) {
          const origin = snapshotCandles(liveOrigin);
          const now = Date.now();
          const probe = travelAttempt(
            controllerRef.current,
            symbol,
            mounted,
            next,
            origin,
            stored,
            0,
            widthRef.current,
            heightRef.current,
            true,
            now,
          );
          if (probe.ok) {
            failedRef.current = null;
            setPinned(origin);
            onHoldRef.current(mounted);
            const touchAt = now;
            const token = travelToken.current;
            const from = mounted;
            wait.current.travel = setTimeout(() => {
              if (token !== travelToken.current || phaseRef.current.kind !== 'live') return;
              const latest = readList(controllerRef.current, symbol, next).candles ?? stored;
              const fresh = snapshotCandles(latest);
              const decidedAt = Date.now();
              const decided = travelAttempt(
                controllerRef.current,
                symbol,
                from,
                next,
                origin,
                fresh,
                decidedAt - touchAt,
                widthRef.current,
                heightRef.current,
                canShow(next),
                decidedAt,
              );
              if (!decided.ok) {
                candlesRef.current = origin;
                setPinned(null);
                fadeOut(from);
                if (!canShow(next)) {
                  ensureWait();
                  beginFetch(next);
                }
                return;
              }
              const session = buildSession(decided.plan, origin);
              sessionRef.current = session;
              shell.setValue(1);
              stageSession(session);
              const traveling: Phase = { kind: 'travel', session };
              phaseRef.current = traveling;
              setPhase(traveling);
              startClocks(session, 1, finished => {
                if (!finished || session.reverse || phaseRef.current.kind !== 'travel') return;
                finishTravel(session.plan.to);
              });
            }, 0);
            return;
          }
        }
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
    [beginFetch, canShow, clearTimers, ensureWait, fadeOut, finishTravel, onFadeDone, onInterval, scheduleReveal, shell, stageSession, symbol],
  );

  const onLayout = useCallback(() => {
    const current = phaseRef.current;
    if (current.kind !== 'in') return;
    const value = seriesRef.current?.value;
    if (!value || revealedRef.current === value) return;
    revealedRef.current = value;
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
      travelToken.current += 1;
      stopClocks(sessionRef.current, () => {});
      clearStaging(sessionRef.current);
      onHoldRef.current(null);
    },
    [clearTimers],
  );

  useEffect(() => {
    if (phase.kind !== 'live') return;
    for (const interval of rowFetchOrder(phase.interval)) {
      if (canShow(interval)) continue;
      void Promise.resolve(controllerRef.current.fetch(getCandles, { symbol, interval })).then(
        () => {
          if (requestedRef.current !== interval) return;
          const kind = phaseRef.current.kind;
          if (kind === 'live' || kind === 'in' || kind === 'travel' || kind === 'travel-out') return;
          if (failedRef.current === interval) failedRef.current = null;
          scheduleReveal(interval);
        },
        () => {},
      );
    }
  }, [canShow, phase, symbol]);

  const sizeRef = useRef({ width, height });
  useEffect(() => {
    const prev = sizeRef.current;
    sizeRef.current = { width, height };
    if (prev.width === width && prev.height === height) return;
    const current = phaseRef.current;
    if (current.kind !== 'travel') return;
    const session = current.session;
    const interval = requestedRef.current;
    stopClocks(session, () => {});
    const value = interval === session.plan.from ? 0 : 1;
    if (session.clock) session.clock.setValue(value);
    else for (const graph of session.steps) graph.progress.setValue(value);
    finishTravel(interval);
  }, [finishTravel, height, width]);

  const follow = useCallback((x: number) => {
    if (phaseRef.current.kind !== 'live') return;
    const candles = candlesRef.current;
    if (!candles || candles.length === 0) return;
    const index = candleIndexAt(x, candles.length, widthRef.current, PixelRatio.get());
    if (index == null) return;
    setScrubIndex(current => (current === index ? current : index));
  }, []);

  const endScrub = useCallback(() => {
    finger.current = false;
    setScrubIndex(null);
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      const type = event.nativeEvent.pointerType;
      if (type === 'touch' || type === 'pen') finger.current = true;
      const x = pointerX(event);
      if (x != null) follow(x);
    },
    [follow],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const type = event.nativeEvent.pointerType;
      if ((type === 'touch' || type === 'pen') && !finger.current) return;
      const x = pointerX(event);
      if (x != null) follow(x);
    },
    [follow],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const type = event.nativeEvent.pointerType;
      if (type !== 'touch' && type !== 'pen') return;
      endScrub();
    },
    [endScrub],
  );

  const onTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      if (Platform.OS === 'web') return;
      finger.current = true;
      follow(event.nativeEvent.locationX);
    },
    [follow],
  );

  const onTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      if (Platform.OS === 'web' || !finger.current) return;
      follow(event.nativeEvent.locationX);
    },
    [follow],
  );

  useEffect(() => {
    if (phase.kind === 'live') return;
    finger.current = false;
    setScrubIndex(null);
  }, [phase.kind]);

  const activeIndex =
    phase.kind === 'live' &&
    scrubIndex != null &&
    published != null &&
    scrubIndex < published.candles.length ?
      scrubIndex
    : null;
  const scrubCandle = activeIndex != null && published ? published.candles[activeIndex] : null;
  const reported = useRef<string | null>(null);

  useLayoutEffect(() => {
    const report = onScrubRef.current;
    if (!report) return;
    const quote =
      scrubCandle && published && phase.kind === 'live' ?
        {
          open: scrubCandle.open,
          close: scrubCandle.close,
          openTime: scrubCandle.openTime,
          interval: published.interval,
        }
      : null;
    const key = quote ? `${quote.interval}:${quote.openTime}:${quote.open}:${quote.close}` : '';
    if (reported.current === key) return;
    reported.current = key;
    report(quote);
  }, [phase.kind, published, scrubCandle]);

  useEffect(() => () => onScrubRef.current?.(null), []);

  const mounted = mountedInterval(phase);
  const session = phase.kind === 'travel' || phase.kind === 'travel-out' ? phase.session : null;
  const subscribed = session ? session.plan.from : mounted;
  const hidden = phase.kind === 'out';
  const showValues = published != null && published.candles.length > 0 && published.interval === mounted;
  const showEmpty = published != null && published.candles.length === 0 && published.interval === mounted;

  return (
    <View style={styles.frame}>
      <IntervalChips value={requested} onSelect={onSelect} onWarm={onWarm} />
      {subscribed ?
        <LiveSeries
          key={subscribed}
          ref={seriesRef}
          symbol={symbol}
          interval={subscribed}
          frozen={
            session ? session.origin
            : phase.kind === 'out' ? frozenRef.current
            : pinned
          }
          instant={phase.kind === 'live'}
          onPublish={publish}
        />
      : null}
      <View
        testID="candles"
        style={[styles.plot, { width, height }]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={endScrub}
        onPointerCancel={endScrub}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={endScrub}
        onTouchCancel={endScrub}
      >
        {session ?
          <Animated.View
            pointerEvents="none"
            needsOffscreenAlphaCompositing
            style={{ position: 'absolute', left: 0, top: 0, width, height, opacity: shell }}
          >
            {session.plan.steps.map((step, index) =>
              shown.includes(index) ?
                <Animated.View
                  key={step.interval}
                  testID={`candle-series-${step.interval}`}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  needsOffscreenAlphaCompositing
                  style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden' }}
                >
                  <CandlePlot
                    symbol={symbol}
                    interval={step.interval}
                    candles={step.candles}
                    width={width}
                    height={height}
                    insetTop={insetTop}
                    insetLeft={insetLeft}
                    motion={session.steps[index].motion}
                    domain={step.domain}
                    showLabels={step.interval === session.plan.to}
                  />
                </Animated.View>
              : null,
            )}
          </Animated.View>
        : null}
        {showValues && published && !session ?
          <Animated.View
            testID={`candle-series-${published.interval}`}
            accessible
            accessibilityLabel={`${symbol} ${intervalLabel(published.interval)} candles`}
            accessibilityElementsHidden={hidden}
            importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
            needsOffscreenAlphaCompositing
            pointerEvents="none"
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
              scrubIndex={activeIndex}
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
        {session ?
          <TravelReadout symbol={symbol} session={session} />
        : showValues && published ?
          <CandleValues
            symbol={symbol}
            candle={scrubCandle ?? published.candles[published.candles.length - 1]}
            opacity={published.opacity}
          />
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

/** Keeps every pill's list while the chart is mounted. `useCache` holds a GC reference and does not fetch. */
function RowHolder({ symbol, interval }: { symbol: string; interval: CandleInterval }): null {
  useCache(getCandles, { symbol, interval });
  return null;
}

function RowHolders({ symbol }: { symbol: string }): JSX.Element {
  return (
    <>
      {INTERVALS.map(item => (
        <RowHolder key={item.value} symbol={symbol} interval={item.value} />
      ))}
    </>
  );
}

export default function ChartBody({
  symbol,
  interval,
  onInterval,
  onRetry,
  retry,
  onHold,
  onScrub,
}: {
  symbol: string;
  interval: CandleInterval;
  onInterval: (interval: CandleInterval) => void;
  onRetry: () => void;
  retry: number;
  onHold?: (interval: CandleInterval | null) => void;
  onScrub?: (quote: ScrubQuote | null) => void;
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
      <RowHolders symbol={symbol} />
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
          onScrub={onScrub}
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
  readoutLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  scrubLabel: {
    position: 'absolute',
    paddingHorizontal: 4,
    paddingVertical: 2,
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
