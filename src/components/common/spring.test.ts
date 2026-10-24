import { Animated } from 'react-native';

import { animateSpring, criticalSpring, retarget, springAt, timeToReach, type Spring } from './spring';

const critical = criticalSpring(20);
const from = (config = critical): Spring => ({ config, target: 1, position: 0, velocity: 0, time: 1000 });

/** Central difference, in units per second. */
function slope(spring: Spring, time: number): number {
  return (springAt(spring, time + 0.01).position - springAt(spring, time - 0.01).position) / 0.00002;
}

it.each([
  ['critical', critical],
  ['under', { mass: 1, stiffness: 400, damping: 12 }],
  ['over', { mass: 1, stiffness: 400, damping: 80 }],
])('starts where it was released and reports its own slope when %s damped', (_, config) => {
  const spring = { ...from(config), position: 0.3, velocity: -2 };
  expect(springAt(spring, spring.time)).toEqual({ position: expect.closeTo(0.3, 9), velocity: expect.closeTo(-2, 9) });
  for (const elapsed of [16, 90, 250]) {
    expect(springAt(spring, spring.time + elapsed).velocity).toBeCloseTo(slope(spring, spring.time + elapsed), 2);
  }
  expect(springAt(spring, spring.time + 5000).position).toBeCloseTo(1, 6);
});

it('matches the critically damped closed form from rest', () => {
  const t = 0.1;
  const expected = 1 - (1 + 20 * t) * Math.exp(-20 * t);
  expect(springAt(from(), 1000 + t * 1000).position).toBeCloseTo(expected, 12);
});

it('keeps position and velocity through a retarget, then pulls the other way', () => {
  const out = from();
  const time = 1080;
  const before = springAt(out, time);
  const back = retarget(out, 0, time);
  expect(back).toMatchObject({ target: 0, time, position: before.position, velocity: before.velocity });
  expect(before.velocity).toBeGreaterThan(0);
  // Momentum carries it further out before it turns.
  expect(springAt(back, time + 10).position).toBeGreaterThan(before.position);
  expect(springAt(back, time + 1000).position).toBeCloseTo(0, 4);
});

it('finds when a spring first reaches a position', () => {
  const out = from();
  const half = timeToReach(out, 0.5)!;
  expect(springAt(out, out.time + half).position).toBeCloseTo(0.5, 2);
  expect(timeToReach(out, 0)).toBe(0);
  expect(timeToReach(out, 1.2)).toBeNull();
  const back = retarget(out, 0, 1080);
  const turned = springAt(back, back.time).position + 0.001;
  expect(timeToReach(back, turned)).toBeGreaterThan(0);
});

describe('animateSpring', () => {
  const spring = jest.spyOn(Animated, 'spring');
  afterEach(() => spring.mockClear());

  it('starts Animated.spring from the spring position and velocity', () => {
    const value = new Animated.Value(0);
    animateSpring(value, { ...from(), position: 0.4, velocity: 3 }, { restDisplacement: 0.01, useNativeDriver: false });
    expect((value as unknown as { __getValue(): number }).__getValue()).toBe(0.4);
    expect(spring.mock.calls[0][1]).toMatchObject({
      toValue: 1,
      velocity: 3,
      stiffness: 400,
      damping: 40,
      mass: 1,
      restDisplacementThreshold: 0.01,
      restSpeedThreshold: 0.001,
      overshootClamping: false,
    });
  });

  it('holds a spring heading away until it comes back inside its start distance', () => {
    const value = new Animated.Value(0);
    animateSpring(value, { ...from(), position: 0.995, velocity: -1 }, { restDisplacement: 0.01, useNativeDriver: false });
    expect(spring.mock.calls[0][1].restDisplacementThreshold).toBeCloseTo(0.00495, 6);
  });
});
