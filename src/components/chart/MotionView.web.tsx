import { useLayoutEffect, useRef, type JSX } from 'react';
import { View } from 'react-native';

import type { MotionStyle, MotionViewProps } from '@/components/chart/motionStyle';

/** The JS driver's current value. Animated has no public sync read for derived nodes. */
function valueOf(node: MotionStyle['opacity']): number {
  return (node as unknown as { __getValue(): number }).__getValue();
}

function cssTransform(transform: NonNullable<MotionStyle['transform']>): string {
  return transform
    .map(entry => {
      const [name, node] = Object.entries(entry)[0];
      return name.startsWith('scale') ? `${name}(${valueOf(node)})` : `${name}(${valueOf(node)}px)`;
    })
    .join(' ');
}

/**
 * Web: react-native-web's Animated re-renders every animated view through React on each frame.
 * This view writes `motion` to the DOM on each `clock` tick instead, in the same frame, with no render.
 */
export function MotionView({ clock, motion, ...view }: MotionViewProps): JSX.Element {
  const ref = useRef<HTMLElement | null>(null);
  const { opacity, transform } = motion;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const draw = () => {
      if (opacity) element.style.opacity = String(valueOf(opacity));
      if (transform) element.style.transform = cssTransform(transform);
    };
    draw();
    const id = clock?.addListener(draw);
    return () => {
      if (id != null) clock?.removeListener(id);
      element.style.opacity = '';
      element.style.transform = '';
    };
  }, [clock, opacity, transform]);

  return <View {...view} ref={ref as never} />;
}
