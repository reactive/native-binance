import { Text, useReducedMotion, useTheme } from '@reactive/silk-native';
import { memo, useEffect, useMemo, useState, type JSX } from 'react';
import { Animated, Easing, PixelRatio, StyleSheet, View } from 'react-native';

import { candleLayout, candleMetrics, PLOT_PAD } from '@/components/chart/candleLayout';
import { easeIn, FADE_IN_MS } from '@/components/chart/chartMotion';
import { MotionView } from '@/components/common/MotionView';
import { NATIVE_DRIVER } from '@/components/common/motionStyle';
import { CANDLE_LIMIT } from '@/resources/Candle';

/** One crest crossing the plot, then a rest before the next. */
const SWEEP_MS = 1500;
const REST_MS = 450;
/** Crest half-width as a fraction of the plot. */
const CREST = 0.16;
/** Ghost marks at rest. */
export const GHOST_OPACITY = 0.45;

type Point = { open: number; high: number; low: number; close: number };

/** A calm, fixed series, so every load draws the same silhouette. */
function ghostSeries(count: number): Point[] {
  const mid = (i: number) =>
    Math.sin((i / count) * Math.PI * 2.4 + 0.5) * 0.22 + (i / count) * 0.4 + Math.sin(i * 1.7) * 0.035;
  return Array.from({ length: count }, (_, i) => {
    const open = mid(i - 1);
    const close = mid(i);
    return {
      open,
      close,
      high: Math.max(open, close) + 0.015 + Math.abs(Math.sin(i * 2.3)) * 0.045,
      low: Math.min(open, close) - 0.015 - Math.abs(Math.cos(i * 1.9)) * 0.045,
    };
  });
}

const GHOST = ghostSeries(CANDLE_LIMIT);

/** Brightness at plot position `at` (0–1) as the crest sweeps from off the left edge to off the right. */
function crestAt(clock: Animated.Value, at: number) {
  const span = 1 + CREST * 2;
  return clock.interpolate({
    inputRange: [0, at / span, (at + CREST) / span, (at + CREST * 2) / span, 1],
    outputRange: [GHOST_OPACITY, GHOST_OPACITY, 1, GHOST_OPACITY, GHOST_OPACITY],
  });
}

/**
 * Ghost candles where the series will draw, with a light sweeping across them.
 * Fills its parent; the parent sets the plot size.
 */
export const ChartSkeleton = memo(function ChartSkeleton({
  width,
  height,
  appear = false,
}: {
  width: number;
  height: number;
  /** Fade in, for a placeholder that replaces a series already on screen. */
  appear?: boolean;
}): JSX.Element {
  const { theme } = useTheme();
  const reduce = useReducedMotion();
  const clock = useState(() => new Animated.Value(0))[0];
  const enter = useState(() => new Animated.Value(0))[0];
  const still = useState(() => new Animated.Value(GHOST_OPACITY))[0];
  const ratio = PixelRatio.get();
  const placed = useMemo(() => candleLayout(GHOST, { width, height, ratio }), [height, ratio, width]);
  const metrics = candleMetrics(width, ratio);
  const crests = useMemo(
    () => placed.map(item => crestAt(clock, item.x / width)),
    [clock, placed, width],
  );

  useEffect(() => {
    if (!appear) return;
    const fade = Animated.timing(enter, {
      toValue: 1,
      duration: reduce ? 0 : FADE_IN_MS,
      easing: easeIn,
      useNativeDriver: NATIVE_DRIVER,
    });
    fade.start();
    return () => fade.stop();
  }, [appear, enter, reduce]);

  useEffect(() => {
    if (reduce) return;
    const sweep = Animated.loop(
      Animated.sequence([
        Animated.timing(clock, {
          toValue: 1,
          duration: SWEEP_MS,
          easing: Easing.linear,
          useNativeDriver: NATIVE_DRIVER,
        }),
        Animated.delay(REST_MS),
      ]),
    );
    sweep.start();
    return () => sweep.stop();
  }, [clock, reduce]);

  const color = theme.semantic.color.borderSubtle;
  const body = metrics.bodyCss;
  const wick = metrics.wick / ratio;
  return (
    <MotionView
      testID="chart-skeleton"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      clock={enter}
      opacity={appear ? enter : undefined}
      style={[StyleSheet.absoluteFill, { width, height }]}
    >
      {placed.map((item, index) => (
        <MotionView
          key={index}
          pointerEvents="none"
          clock={clock}
          opacity={reduce ? still : crests[index]}
          style={[
            styles.mark,
            {
              left: item.x,
              top: item.wickTop,
              width: body,
              height: item.wickHeight,
            },
          ]}
        >
          <View
            style={[
              styles.mark,
              { left: (body - wick) / 2, top: 0, width: wick, height: item.wickHeight, backgroundColor: color },
            ]}
          />
          <View
            style={[
              styles.mark,
              styles.body,
              {
                left: 0,
                top: item.bodyTop - item.wickTop,
                width: body,
                height: Math.max(item.bodyHeight, wick * 2),
                backgroundColor: color,
              },
            ]}
          />
        </MotionView>
      ))}
    </MotionView>
  );
});

/** Loading caption in the plot's top band, announced to screen readers. */
export function PlotCaption({ children, testID }: { children: string; testID?: string }): JSX.Element {
  return (
    <View pointerEvents="none" style={styles.caption}>
      <Text role="caption" tone="secondary" accessibilityLiveRegion="polite" testID={testID}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    position: 'absolute',
  },
  body: {
    borderRadius: 1,
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: PLOT_PAD,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
});
