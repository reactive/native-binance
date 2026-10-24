import { Platform, type Animated, type ViewProps } from 'react-native';

// Jest's native animated mock ends the spring in 16ms without moving `p`.
// The device still uses the native driver; web and tests run the same JS graph.
export const NATIVE_DRIVER = Platform.OS !== 'web' && process.env.JEST_WORKER_ID == null;

type Motion = Animated.AnimatedNode;

/** Animated opacity and transforms. Transforms apply in this order: translateX, translateY, scaleX, scaleY. */
export type MotionViewProps = ViewProps & {
  /** The value every motion node is derived from. Web redraws on its ticks. */
  clock?: Animated.Value;
  opacity?: Motion;
  translateX?: Motion;
  translateY?: Motion;
  scaleX?: Motion;
  scaleY?: Motion;
};
