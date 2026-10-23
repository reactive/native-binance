import type { Animated, ViewProps } from 'react-native';

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
