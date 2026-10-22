import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** A step on screen sooner than this after the clock starts mounts in the start commit. */
export const START_COMMIT_MS = 50;

/** A step whose time-sliced mount has not committed by this long before it is on screen mounts urgently. */
export const URGENT_LEAD_MS = 34;

export type StepTiming = {
  mountAt: number;
  visibleAt: number;
};

export type StagedMount =
  | { index: number; kind: 'immediate' }
  | { index: number; kind: 'deferred'; transitionAt: number; urgentAt: number };

/** Which steps mount in the start commit, and when each later step slices or falls back. */
export function stageMounts(steps: readonly StepTiming[]): StagedMount[] {
  return steps.map((step, index) =>
    step.visibleAt < START_COMMIT_MS ?
      { index, kind: 'immediate' }
    : {
        index,
        kind: 'deferred',
        transitionAt: step.mountAt,
        urgentAt: step.visibleAt - URGENT_LEAD_MS,
      },
  );
}

export function appendStep(shown: readonly number[], index: number): readonly number[] {
  return shown.includes(index) ? shown : [...shown, index];
}

type MountClock = {
  later: (delay: number, run: () => void) => void;
  show: (indices: readonly number[]) => void;
  transition: (index: number) => void;
  urgent: (index: number) => void;
};

/** Schedules mounts from step timings. The start commit is shown before any sliced mount is queued. */
export function scheduleMounts(steps: readonly StepTiming[], clock: MountClock): void {
  const plan = stageMounts(steps);
  clock.show(plan.flatMap(step => (step.kind === 'immediate' ? [step.index] : [])));
  for (const step of plan) {
    if (step.kind !== 'deferred') continue;
    const mount = () => clock.transition(step.index);
    if (step.transitionAt <= 0) mount();
    else clock.later(step.transitionAt, mount);
    clock.later(step.urgentAt, () => clock.urgent(step.index));
  }
}

/**
 * Mounts travel steps from their plan timings.
 * `stage` shows the start-commit steps in that turn. `cancel` drops timers and keeps what is already shown.
 * `reset` drops timers and clears the shown set.
 */
export function useStagedMounts(onMount: (index: number) => void): {
  shown: readonly number[];
  stage: (steps: readonly StepTiming[], token: object) => void;
  cancel: () => void;
  reset: () => void;
} {
  const [shown, setShown] = useState<readonly number[]>([]);
  const shownRef = useRef(shown);
  const tokenRef = useRef<object | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const onMountRef = useRef(onMount);

  useLayoutEffect(() => {
    onMountRef.current = onMount;
    shownRef.current = shown;
  }, [onMount, shown]);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  const stage = useCallback(
    (steps: readonly StepTiming[], token: object) => {
      clearTimers();
      tokenRef.current = token;
      shownRef.current = [];
      const later = (delay: number, run: () => void) => {
        const timer = setTimeout(() => {
          if (tokenRef.current === token) run();
        }, delay);
        timers.current.push(timer);
      };
      scheduleMounts(steps, {
        later,
        show: indices => setShown(indices),
        transition: index => {
          onMountRef.current(index);
          startTransition(() => setShown(current => appendStep(current, index)));
        },
        urgent: index => {
          if (shownRef.current.includes(index)) return;
          onMountRef.current(index);
          setShown(current => appendStep(current, index));
        },
      });
    },
    [clearTimers],
  );

  const cancel = useCallback(() => {
    clearTimers();
    tokenRef.current = null;
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    tokenRef.current = null;
    setShown([]);
  }, [clearTimers]);

  useEffect(() => () => cancel(), [cancel]);

  return { shown, stage, cancel, reset };
}
