import { useEffect } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { START_COMMIT_MS, URGENT_LEAD_MS, useStagedMounts } from './useStagedMounts';

function Harness() {
  const staged = useStagedMounts();
  useEffect(() => {
    harness = staged;
  });
  return null;
}

let harness: ReturnType<typeof useStagedMounts> | null = null;

/** A start-commit step and a step sliced in at 40 ms that is on screen at 120 ms. */
const TWO_STEPS = [
  { mountAt: 0, visibleAt: 0 },
  { mountAt: 40, visibleAt: 120 },
];

beforeEach(() => {
  harness = null;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function mountHarness() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Harness />);
  });
  return tree;
}

/** Sliced updates never commit, as if every transition stayed pending. */
function holdTransitions() {
  const react = jest.requireActual<typeof import('react')>('react');
  jest.spyOn(react, 'startTransition').mockImplementation(() => {});
}

it('mounts a step in the start commit only when it is on screen within 50 ms', () => {
  holdTransitions();
  const mounted: number[] = [];
  mountHarness();
  act(() => {
    harness?.stage(
      [
        { mountAt: 0, visibleAt: 0 },
        { mountAt: 0, visibleAt: START_COMMIT_MS - 1 },
        { mountAt: 0, visibleAt: START_COMMIT_MS },
        { mountAt: 0, visibleAt: 89 },
      ],
      index => mounted.push(index),
    );
  });
  expect(harness?.shown).toEqual([0, 1]);
  expect(mounted).toEqual([0, 1, 2, 3]);
});

it('keeps the start commit when a sliced step mounts in the same turn', () => {
  mountHarness();
  act(() => {
    harness?.stage(
      [
        { mountAt: 0, visibleAt: 0 },
        { mountAt: 0, visibleAt: 89 },
      ],
      () => {},
    );
  });
  expect(harness?.shown).toEqual([0, 1]);
});

it('shows the start commit immediately and the sliced steps after their timers', () => {
  const mounted: number[] = [];
  const tree = mountHarness();
  act(() => {
    harness?.stage(TWO_STEPS, index => mounted.push(index));
  });
  expect(harness?.shown).toEqual([0]);
  expect(mounted).toEqual([0]);
  act(() => {
    jest.advanceTimersByTime(40);
  });
  expect(mounted).toEqual([0, 1]);
  expect(harness?.shown).toEqual([0, 1]);
  act(() => {
    jest.advanceTimersByTime(120 - URGENT_LEAD_MS);
  });
  expect(mounted).toEqual([0, 1]);
  expect(harness?.shown).toEqual([0, 1]);
  act(() => {
    tree.unmount();
  });
});

it('keeps the start commit when a later step is cancelled', () => {
  const mounted: number[] = [];
  mountHarness();
  act(() => {
    harness?.stage(TWO_STEPS, index => mounted.push(index));
    harness?.cancel();
  });
  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(harness?.shown).toEqual([0]);
  expect(mounted).toEqual([0]);
});

it('drops a sliced mount that is still pending when cancelled', () => {
  mountHarness();
  act(() => {
    harness?.stage(TWO_STEPS, () => {});
  });
  act(() => {
    jest.advanceTimersByTime(40);
    harness?.cancel();
  });
  expect(harness?.shown).toEqual([0]);
});

it('drops a pending sliced mount from the previous stage', () => {
  mountHarness();
  act(() => {
    harness?.stage([{ mountAt: 40, visibleAt: 120 }], () => {});
  });
  act(() => {
    jest.advanceTimersByTime(40);
    harness?.stage([{ mountAt: 0, visibleAt: 0 }], () => {});
  });
  expect(harness?.shown).toEqual([0]);
});

it('mounts urgently when the sliced update has not committed', () => {
  holdTransitions();
  const mounted: number[] = [];
  mountHarness();
  act(() => {
    harness?.stage([{ mountAt: 0, visibleAt: 89 }], index => mounted.push(index));
  });
  expect(harness?.shown).toEqual([]);
  expect(mounted).toEqual([0]);
  act(() => {
    jest.advanceTimersByTime(89 - URGENT_LEAD_MS);
  });
  expect(mounted).toEqual([0]);
  expect(harness?.shown).toEqual([0]);
});

it('clears the shown steps on reset', () => {
  mountHarness();
  act(() => {
    harness?.stage([{ mountAt: 0, visibleAt: 0 }], () => {});
  });
  expect(harness?.shown).toEqual([0]);
  act(() => {
    harness?.reset();
  });
  expect(harness?.shown).toEqual([]);
});
