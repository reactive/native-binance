import { Animated } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { MotionView } from './MotionView.web';

// The native View mock is a class, so its ref is not the host node that `createNodeMock` returns.
jest.mock('react-native/Libraries/Components/View/View', () => {
  const { createElement, forwardRef } = jest.requireActual<typeof import('react')>('react');
  return { __esModule: true, default: forwardRef((props: object, ref) => createElement('View', { ...props, ref })) };
});

function valueOf(node: Animated.AnimatedNode): number {
  return (node as unknown as { __getValue(): number }).__getValue();
}

function mount(element: React.ReactElement) {
  const style: Record<string, string> = {};
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element, { createNodeMock: () => ({ style }) });
  });
  return { style, tree };
}

it('writes the nodes on every clock tick, with the same values Animated computes', () => {
  const clock = new Animated.Value(0);
  const raw = clock.interpolate({ inputRange: [0, 1], outputRange: [0, 37.5], extrapolate: 'clamp' });
  const shift = Animated.subtract(raw, Animated.modulo(raw, 1));
  const scaleX = clock.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25], extrapolate: 'clamp' });
  const opacity = clock.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0], extrapolate: 'clamp' });
  const { style } = mount(
    <MotionView clock={clock} motion={{ opacity, transform: [{ translateX: shift }, { scaleX }] }} />,
  );

  for (const at of [0, 0.13, 0.5, 0.77, 1]) {
    act(() => clock.setValue(at));
    expect(style.opacity).toBe(String(valueOf(opacity)));
    expect(style.transform).toBe(`translateX(${valueOf(shift)}px) scaleX(${valueOf(scaleX)})`);
  }
  expect(style.transform).toBe('translateX(37px) scaleX(0.25)');
});

it('stops writing and clears its styles on unmount', () => {
  const clock = new Animated.Value(0);
  const opacity = clock.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const { style, tree } = mount(<MotionView clock={clock} motion={{ opacity }} />);
  expect(style.opacity).toBe('1');
  act(() => tree.unmount());
  expect(style.opacity).toBe('');
  act(() => clock.setValue(1));
  expect(style.opacity).toBe('');
});

it('leaves a view with no motion untouched', () => {
  const { style } = mount(<MotionView motion={{}} />);
  expect(style).toEqual({});
});
