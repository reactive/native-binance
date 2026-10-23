import type { JSX } from 'react';
import { Animated } from 'react-native';

import type { MotionViewProps } from '@/components/chart/motionStyle';

/** Native: an `Animated.View`, so the native driver moves it off the JS thread. */
export function MotionView({ clock: _clock, motion, style, ...view }: MotionViewProps): JSX.Element {
  return <Animated.View {...view} style={[style, motion]} />;
}
