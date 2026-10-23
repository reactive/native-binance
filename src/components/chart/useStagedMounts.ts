import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** A step on screen sooner than this after the clock starts mounts in the start commit. */
export const START_COMMIT_MS = 50;

/** A step whose time-sliced mount has not committed by this long before it is on screen mounts urgently. */
export const URGENT_LEAD_MS = 34;

function add(index: number) {
  return (current: readonly number[]) => (current.includes(index) ? current : [...current, index]);
}

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
      const attached = new Set<number>();
      const attach = (index: number) => {
        if (attached.has(index)) return;
        attached.add(index);
        onMount(index);
      };
      const start: number[] = [];
      const sliced: number[] = [];
      steps.forEach((step, index) => (step.visibleAt < START_COMMIT_MS ? start : sliced).push(index));
      start.forEach(attach);
      // The start commit is a replacement, so it is queued before any sliced mount it would otherwise drop.
      shownRef.current = start;
      setShown(start);
      for (const index of sliced) {
        const { mountAt, visibleAt } = steps[index];
        const mount = () => {
          attach(index);
          startTransition(() => setShown(add(index)));
        };
        if (mountAt <= 0) mount();
        else timers.current.push(setTimeout(mount, mountAt));
        timers.current.push(
          setTimeout(() => {
            if (shownRef.current.includes(index)) return;
            attach(index);
            setShown(add(index));
          }, visibleAt - URGENT_LEAD_MS),
        );
      }
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
