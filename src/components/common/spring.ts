import { Animated } from 'react-native';

/**
 * A damped harmonic oscillator, solved in closed form like wobble and Motion's spring.
 * Any instant is exact, so a spring can be interrupted and sent somewhere else at the speed it was moving.
 */
export type SpringConfig = { stiffness: number; damping: number; mass: number };

export type SpringState = { position: number; velocity: number };

/** A spring released at `time` (ms) from `position` with `velocity` (units per second), pulling toward `target`. */
export type Spring = Readonly<SpringState & { config: SpringConfig; target: number; time: number }>;

/** Critical damping: the fastest approach that never overshoots from rest. `omega` is in radians per second. */
export function criticalSpring(omega: number): SpringConfig {
  return { mass: 1, stiffness: omega * omega, damping: 2 * omega };
}

export function springAt(spring: Spring, time: number): SpringState {
  const { stiffness, damping, mass } = spring.config;
  const t = Math.max(0, time - spring.time) / 1000;
  const x0 = spring.position - spring.target;
  const v0 = spring.velocity;
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  let x: number;
  let v: number;
  if (Math.abs(zeta - 1) < 1e-6) {
    const b = v0 + omega * x0;
    const envelope = Math.exp(-omega * t);
    x = envelope * (x0 + b * t);
    v = envelope * (v0 - omega * b * t);
  } else if (zeta < 1) {
    const decay = zeta * omega;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const b = (v0 + decay * x0) / wd;
    const envelope = Math.exp(-decay * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    x = envelope * (x0 * cos + b * sin);
    v = envelope * (v0 * cos - (decay * b + wd * x0) * sin);
  } else {
    const root = omega * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * omega + root;
    const r2 = -zeta * omega - root;
    const c1 = (v0 - r2 * x0) / (r1 - r2);
    const c2 = x0 - c1;
    x = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
    v = c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t);
  }
  return { position: spring.target + x, velocity: v };
}

/** The same spring, pulling toward `target` from wherever it is at `time`, with the velocity it has there. */
export function retarget(spring: Spring, target: number, time: number): Spring {
  return { ...spring, ...springAt(spring, time), target, time };
}

/** Slowest exponential decay rate, in 1/s. Past 12 time constants the motion is below 1e-5 of its size. */
function decayRate({ stiffness, damping, mass }: SpringConfig): number {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  return zeta <= 1 ? zeta * omega : omega * (zeta - Math.sqrt(zeta * zeta - 1));
}

/** ms after `spring.time` when the spring first reaches `position`, 0 if it starts there, or null if it never does. */
export function timeToReach(spring: Spring, position: number): number | null {
  const side = (time: number) => Math.sign(springAt(spring, time).position - position);
  const start = side(spring.time);
  if (start === 0) return 0;
  const horizon = 12_000 / decayRate(spring.config);
  const step = 8;
  for (let elapsed = step; elapsed <= horizon; elapsed += step) {
    if (side(spring.time + elapsed) === start) continue;
    let lo = elapsed - step;
    let hi = elapsed;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (side(spring.time + mid) === start) lo = mid;
      else hi = mid;
    }
    return hi;
  }
  return null;
}

export type AnimateSpringOptions = {
  /** Ends the animation, snapped to the target, once it is this close. */
  restDisplacement: number;
  /** Speed below which a close enough spring rests. Animated.spring defaults to 0.001. */
  restSpeed?: number;
  /** Ends the animation where it first passes the target. */
  overshootClamping?: boolean;
  useNativeDriver: boolean;
};

/**
 * Plays `spring` on `value` from its own position and velocity.
 * Animated.spring solves the same closed form, on the UI thread with the native driver.
 */
export function animateSpring(
  value: Animated.Value,
  spring: Spring,
  { restDisplacement, restSpeed = 0.001, overshootClamping = false, useNativeDriver }: AnimateSpringOptions,
): Animated.CompositeAnimation {
  const distance = Math.abs(spring.target - spring.position);
  const away = (spring.target - spring.position) * spring.velocity < 0;
  value.setValue(spring.position);
  return Animated.spring(value, {
    toValue: spring.target,
    velocity: spring.velocity,
    ...spring.config,
    overshootClamping,
    // Heading away, the first frame can already be inside the rest distance. Hold until it comes back.
    restDisplacementThreshold: away ? Math.min(restDisplacement, distance * 0.99) : restDisplacement,
    restSpeedThreshold: restSpeed,
    useNativeDriver,
  });
}
