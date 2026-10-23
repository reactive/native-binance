import type { Animated, ViewProps } from 'react-native';

type Motion = Animated.AnimatedNode;

/** The animated part of a view's style: opacity, and transforms in RN order. */
export type MotionStyle = {
  opacity?: Motion;
  transform?: readonly (
    | { translateX: Motion }
    | { translateY: Motion }
    | { scaleX: Motion }
    | { scaleY: Motion }
  )[];
};

export type MotionViewProps = ViewProps & {
  /** Drives every node in `motion`. Web redraws on its ticks; native ignores it. */
  clock?: Animated.Value;
  motion: MotionStyle;
};
