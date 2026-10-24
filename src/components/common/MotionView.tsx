import type { JSX } from 'react';
import { Animated } from 'react-native';

import type { MotionViewProps } from '@/components/common/motionStyle';

/** Native: an `Animated.View`, so the native driver moves it off the JS thread. */
export function MotionView({
  clock: _clock,
  opacity,
  translateX,
  translateY,
  scaleX,
  scaleY,
  style,
  ...view
}: MotionViewProps): JSX.Element {
  const axes = { translateX, translateY, scaleX, scaleY };
  const transform = Object.entries(axes).flatMap(([name, node]) => (node ? [{ [name]: node }] : []));
  return (
    <Animated.View
      {...view}
      style={[style, { opacity, transform: transform.length > 0 ? transform : undefined }]}
    />
  );
}
