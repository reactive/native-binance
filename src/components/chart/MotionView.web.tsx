import { useLayoutEffect, useRef, type JSX } from 'react';
import { View } from 'react-native';

import type { MotionViewProps } from '@/components/chart/motionStyle';

type Motion = MotionViewProps['opacity'];

/** The JS driver's current value. Animated has no public sync read for derived nodes. */
function valueOf(node: NonNullable<Motion>): number {
  return (node as unknown as { __getValue(): number }).__getValue();
}

/**
 * Web: react-native-web's Animated re-renders every animated view through React on each frame.
 * This view writes its motion to the DOM on each `clock` tick instead, in the same frame, with no render.
 */
export function MotionView({
  clock,
  opacity,
  translateX,
  translateY,
  scaleX,
  scaleY,
  ...view
}: MotionViewProps): JSX.Element {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const axes = [
      ['translateX', translateX, 'px'],
      ['translateY', translateY, 'px'],
      ['scaleX', scaleX, ''],
      ['scaleY', scaleY, ''],
    ] as const;
    const moving = axes.filter(([, node]) => node);
    if (!element || (!opacity && moving.length === 0)) return;
    const draw = () => {
      if (opacity) element.style.opacity = String(valueOf(opacity));
      if (moving.length > 0) {
        element.style.transform = moving
          .map(([name, node, unit]) => `${name}(${valueOf(node!)}${unit})`)
          .join(' ');
      }
    };
    draw();
    const id = clock?.addListener(draw);
    return () => {
      if (id != null) clock?.removeListener(id);
      element.style.opacity = '';
      element.style.transform = '';
    };
  }, [clock, opacity, translateX, translateY, scaleX, scaleY]);

  return <View {...view} ref={ref as never} />;
}
