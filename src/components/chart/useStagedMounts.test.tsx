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

beforeEach(() => {
  harness = null;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function mountHarness() {
  act(() => {
    TestRenderer.create(<Harness />);
  });
}

it('mounts a step in the start commit only when it is on screen within 50 ms', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const spy = jest.spyOn(react, 'startTransition').mockImplementation(() => {});
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
  expect(mounted).toEqual([2, 3]);
  spy.mockRestore();
});

it('shows the start commit immediately and the sliced steps after their timers', () => {
  const mounted: number[] = [];
  let tree: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Harness />);
  });
  act(() => {
    harness?.stage(
      [
        { mountAt: 0, visibleAt: 0 },
        { mountAt: 40, visibleAt: 120 },
      ],
      index => mounted.push(index),
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
    jest.advanceTimersByTime(120 - URGENT_LEAD_MS);
  });
  expect(mounted).toEqual([1]);
  expect(harness?.shown).toEqual([0, 1]);
  act(() => {
    tree.unmount();
  });
});

it('keeps the start commit when a later step is cancelled', () => {
  const mounted: number[] = [];
  mountHarness();
  act(() => {
    harness?.stage(
      [
        { mountAt: 0, visibleAt: 0 },
        { mountAt: 40, visibleAt: 120 },
      ],
      index => mounted.push(index),
    );
    harness?.cancel();
  });
  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(harness?.shown).toEqual([0]);
  expect(mounted).toEqual([]);
});

it('drops a sliced mount that is still pending when cancelled', () => {
  mountHarness();
  act(() => {
    harness?.stage(
      [
        { mountAt: 0, visibleAt: 0 },
        { mountAt: 40, visibleAt: 120 },
      ],
      () => {},
    );
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
  const react = jest.requireActual<typeof import('react')>('react');
  const spy = jest.spyOn(react, 'startTransition').mockImplementation(() => {});
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
  expect(mounted).toEqual([0, 0]);
  expect(harness?.shown).toEqual([0]);
  spy.mockRestore();
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
