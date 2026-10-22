import TestRenderer, { act } from 'react-test-renderer';

import {
  START_COMMIT_MS,
  URGENT_LEAD_MS,
  appendStep,
  scheduleMounts,
  stageMounts,
  useStagedMounts,
  type StepTiming,
} from './useStagedMounts';

const STEPS: StepTiming[] = [
  { mountAt: 0, visibleAt: 0 },
  { mountAt: 0, visibleAt: START_COMMIT_MS - 1 },
  { mountAt: 0, visibleAt: START_COMMIT_MS },
  { mountAt: 0, visibleAt: 89 },
  { mountAt: 45, visibleAt: 195 },
];

function clock() {
  const timers: { delay: number; run: () => void }[] = [];
  const transition: number[] = [];
  const urgent: number[] = [];
  let shown: readonly number[] = [];
  const committed = new Set<number>();
  scheduleMounts(STEPS, {
    later: (delay, run) => timers.push({ delay, run }),
    show: indices => {
      shown = indices;
      for (const index of indices) committed.add(index);
    },
    transition: index => transition.push(index),
    urgent: index => {
      urgent.push(index);
      if (committed.has(index)) return;
      shown = appendStep(shown, index);
      committed.add(index);
    },
  });
  return {
    timers,
    transition,
    urgent,
    committed,
    shown: () => shown,
    run(delay: number) {
      const due = timers.filter(timer => timer.delay === delay);
      for (const timer of due) timer.run();
    },
  };
}

it('mounts only steps on screen within 50 ms in the start commit', () => {
  expect(stageMounts(STEPS)).toEqual([
    { index: 0, kind: 'immediate' },
    { index: 1, kind: 'immediate' },
    { index: 2, kind: 'deferred', transitionAt: 0, urgentAt: START_COMMIT_MS - URGENT_LEAD_MS },
    { index: 3, kind: 'deferred', transitionAt: 0, urgentAt: 89 - URGENT_LEAD_MS },
    { index: 4, kind: 'deferred', transitionAt: 45, urgentAt: 195 - URGENT_LEAD_MS },
  ]);
});

it('slices a step that is already due when it is still 50 ms from the screen', () => {
  const plan = stageMounts([{ mountAt: 0, visibleAt: 89 }]);
  expect(plan).toEqual([{ index: 0, kind: 'deferred', transitionAt: 0, urgentAt: 55 }]);
});

it('keeps an append idempotent', () => {
  const shown = [0, 2];
  expect(appendStep(shown, 2)).toBe(shown);
  expect(appendStep(shown, 1)).toEqual([0, 2, 1]);
});

it('runs the sliced mount at mountAt and the urgent mount only if it has not committed', () => {
  const staged = clock();
  expect(staged.shown()).toEqual([0, 1]);
  expect(staged.transition).toEqual([2, 3]);
  expect(staged.timers.map(timer => timer.delay).sort((a, b) => a - b)).toEqual(
    [45, START_COMMIT_MS - URGENT_LEAD_MS, 89 - URGENT_LEAD_MS, 195 - URGENT_LEAD_MS].sort((a, b) => a - b),
  );

  staged.run(START_COMMIT_MS - URGENT_LEAD_MS);
  staged.run(89 - URGENT_LEAD_MS);
  expect(staged.urgent).toEqual([2, 3]);
  expect(staged.shown()).toEqual([0, 1, 2, 3]);

  staged.run(45);
  expect(staged.transition).toEqual([2, 3, 4]);
  staged.committed.add(4);
  staged.run(195 - URGENT_LEAD_MS);
  expect(staged.urgent).toEqual([2, 3, 4]);
  expect(staged.shown()).toEqual([0, 1, 2, 3]);
});

function Harness({ onMount }: { onMount: (index: number) => void }) {
  const staged = useStagedMounts(onMount);
  harness = staged;
  return null;
}

let harness: ReturnType<typeof useStagedMounts> | null = null;

beforeEach(() => {
  harness = null;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('shows the start commit immediately and the sliced steps after their timers', () => {
  const mounted: number[] = [];
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Harness onMount={index => mounted.push(index)} />);
  });
  const token = {};
  act(() => {
    harness?.stage(
      [
        { mountAt: 0, visibleAt: 0 },
        { mountAt: 40, visibleAt: 120 },
      ],
      token,
    );
  });
  expect(harness?.shown).toEqual([0]);
  expect(mounted).toEqual([]);
  act(() => {
    jest.advanceTimersByTime(40);
  });
  expect(mounted).toEqual([1]);
  expect(harness?.shown).toEqual([0, 1]);
  act(() => {
    jest.advanceTimersByTime(120);
  });
  expect(harness?.shown).toEqual([0, 1]);
  act(() => {
    tree.unmount();
  });
});

it('drops a deferred step when staging is cancelled before its timer', () => {
  const mounted: number[] = [];
  act(() => {
    TestRenderer.create(<Harness onMount={index => mounted.push(index)} />);
  });
  act(() => {
    harness?.stage([{ mountAt: 40, visibleAt: 120 }], {});
    harness?.cancel();
  });
  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(harness?.shown).toEqual([]);
  expect(mounted).toEqual([]);
});

it('mounts urgently when the sliced update has not committed', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const spy = jest.spyOn(react, 'startTransition').mockImplementation(() => {});
  const mounted: number[] = [];
  act(() => {
    TestRenderer.create(<Harness onMount={index => mounted.push(index)} />);
  });
  act(() => {
    harness?.stage([{ mountAt: 0, visibleAt: 89 }], {});
  });
  expect(harness?.shown).toEqual([]);
  expect(mounted).toEqual([0]);
  act(() => {
    jest.advanceTimersByTime(89 - URGENT_LEAD_MS);
  });
  expect(mounted).toEqual([0, 0]);
  expect(harness?.shown).toEqual([0]);
  spy.mockRestore();
});

it('clears the shown steps on reset', () => {
  act(() => {
    TestRenderer.create(<Harness onMount={() => {}} />);
  });
  act(() => {
    harness?.stage([{ mountAt: 0, visibleAt: 0 }], {});
  });
  expect(harness?.shown).toEqual([0]);
  act(() => {
    harness?.reset();
  });
  expect(harness?.shown).toEqual([]);
});
