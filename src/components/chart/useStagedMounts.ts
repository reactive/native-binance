import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** A step on screen sooner than this after the clock starts mounts in the start commit. */
export const START_COMMIT_MS = 50;

/** A step whose time-sliced mount has not committed by this long before it is on screen mounts urgently. */
export const URGENT_LEAD_MS = 34;

export type StepTiming = {
  mountAt: number;
  visibleAt: number;
};

/**
 * Mounts travel steps from their plan timings.
 * `stage` shows the start-commit steps in that turn. `cancel` drops timers and pending sliced mounts, and keeps what is
 * already shown.
 * `reset` drops timers and clears the shown set.
 */
export function useStagedMounts(): {
  shown: readonly number[];
  stage: (steps: readonly StepTiming[], onMount: (index: number) => void) => void;
  cancel: () => void;
  reset: () => void;
} {
  const [shown, setShown] = useState<readonly number[]>([]);
  const shownRef = useRef(shown);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const onMountRef = useRef<(index: number) => void>(() => {});

  useLayoutEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  const stage = useCallback(
    (steps: readonly StepTiming[], onMount: (index: number) => void) => {
      clearTimers();
      onMountRef.current = onMount;
      const add = (index: number) => (current: readonly number[]) =>
        current.includes(index) ? current : [...current, index];
      const later = (delay: number, run: () => void) => {
        timers.current.push(setTimeout(run, delay));
      };
      // The start commit is shown before any sliced mount is queued. It is urgent, so it commits before any timer.
      const start = steps.flatMap((step, index) => (step.visibleAt < START_COMMIT_MS ? [index] : []));
      shownRef.current = start;
      setShown(start);
      steps.forEach((step, index) => {
        if (step.visibleAt < START_COMMIT_MS) return;
        const mount = () => {
          onMountRef.current(index);
          startTransition(() => setShown(add(index)));
        };
        if (step.mountAt <= 0) mount();
        else later(step.mountAt, mount);
        later(step.visibleAt - URGENT_LEAD_MS, () => {
          if (shownRef.current.includes(index)) return;
          onMountRef.current(index);
          setShown(add(index));
        });
      });
    },
    [clearTimers],
  );

  // React applies queued updates in order, so this replacement wins over any sliced mount still pending.
  const cancel = useCallback(() => {
    clearTimers();
    setShown(shownRef.current);
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setShown([]);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  return { shown, stage, cancel, reset };
}
