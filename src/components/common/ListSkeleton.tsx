import { useTheme } from '@reactive/silk-native';
import { useEffect, useState, type JSX } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { MotionView } from '@/components/chart/MotionView';
import { NATIVE_DRIVER } from '@/components/chart/motionStyle';
import { useReduceMotion } from '@/components/common/useReduceMotion';

const PULSE_MS = 1200;
const ROWS = 14;
/** Fixed widths, so rows look like varied values without moving between renders. */
const LEFT = ['42%', '36%', '48%', '40%', '33%', '45%', '38%'] as const;
const RIGHT = ['22%', '28%', '18%', '25%', '20%', '30%', '24%'] as const;

/**
 * Rows of ghost values with one shared pulse.
 * One animated layer, so web writes a single opacity per frame instead of re-rendering each bar.
 */
export function ListSkeleton({ rowHeight, testID }: { rowHeight: number; testID?: string }): JSX.Element {
  const { theme } = useTheme();
  const reduce = useReduceMotion();
  const pulse = useState(() => new Animated.Value(1))[0];

  useEffect(() => {
    if (reduce) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: PULSE_MS / 2, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS / 2, useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);

  const color = theme.semantic.color.borderSubtle;
  return (
    <MotionView
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      clock={pulse}
      opacity={pulse}
      style={styles.list}
    >
      {Array.from({ length: ROWS }, (_, index) => (
        <View key={index} style={[styles.row, { height: rowHeight }]}>
          <View style={[styles.bar, { width: LEFT[index % LEFT.length], backgroundColor: color }]} />
          <View style={[styles.bar, { width: RIGHT[index % RIGHT.length], backgroundColor: color }]} />
        </View>
      ))}
    </MotionView>
  );
}

const styles = StyleSheet.create({
  list: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  bar: {
    height: 12,
    borderRadius: 3,
  },
});
