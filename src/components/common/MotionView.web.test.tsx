import { Animated } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { MotionView } from './MotionView.web';

// Jest renders the native View, a class whose ref is the instance. The web View's ref is the DOM node.
jest.mock('react-native/Libraries/Components/View/View', () => {
  const { createElement, forwardRef } = jest.requireActual<typeof import('react')>('react');
  return { __esModule: true, default: forwardRef((props: object, ref) => createElement('View', { ...props, ref })) };
});

function mount(element: React.ReactElement) {
  const style: Record<string, string> = {};
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element, { createNodeMock: () => ({ style }) });
  });
  return { style, tree };
}

it('writes opacity and transforms on every clock tick', () => {
  const clock = new Animated.Value(0);
  const raw = clock.interpolate({ inputRange: [0, 1], outputRange: [0, 37.5], extrapolate: 'clamp' });
  const { style } = mount(
    <MotionView
      clock={clock}
      opacity={clock.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] })}
      translateX={Animated.subtract(raw, Animated.modulo(raw, 1))}
      scaleX={clock.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] })}
    />,
  );
  expect(style).toEqual({ opacity: '1', transform: 'translateX(0px) scaleX(1)' });
  act(() => clock.setValue(0.25));
  expect(style).toEqual({ opacity: '0.5', transform: 'translateX(9px) scaleX(0.8125)' });
  act(() => clock.setValue(1));
  expect(style).toEqual({ opacity: '0', transform: 'translateX(37px) scaleX(0.25)' });
});

it('stops writing and clears its styles on unmount', () => {
  const clock = new Animated.Value(0);
  const opacity = clock.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const { style, tree } = mount(<MotionView clock={clock} opacity={opacity} />);
  expect(style.opacity).toBe('1');
  act(() => tree.unmount());
  expect(style.opacity).toBe('');
  act(() => clock.setValue(1));
  expect(style.opacity).toBe('');
});

it('does not subscribe without motion', () => {
  const clock = new Animated.Value(0);
  const { style } = mount(<MotionView clock={clock} />);
  expect(clock.hasListeners()).toBe(false);
  expect(style).toEqual({});
});
