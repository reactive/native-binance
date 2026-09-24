import { renderHook, act } from '@data-client/test';
import { NavigationContext } from 'expo-router/build/react-navigation/core/NavigationContext';
import type { NavigationProp } from 'expo-router/build/react-navigation/core/types';
import { ScreenRemovalPreventionSetterContext } from 'expo-router/build/global-state/removalPrevention';
import type { ReactNode } from 'react';

import { useDismissSearchOnBack } from '@/components/dismissSearch';

const back = { type: 'GO_BACK' as const };

function createNavigation() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const dispatched: unknown[] = [];
  const navigation = {
    dispatched,
    addListener(type: string, listener: (event: unknown) => void) {
      const set = listeners.get(type) ?? new Set<(event: unknown) => void>();
      set.add(listener);
      listeners.set(type, set);
      return () => {
        set.delete(listener);
      };
    },
    dispatch(action: unknown) {
      dispatched.push(action);
    },
    pressBack() {
      const event = { type: 'removePrevented', data: { action: back } };
      listeners.get('removePrevented')?.forEach(listener => listener(event));
    },
  };
  return navigation;
}

function renderBack(open: boolean) {
  const navigation = createNavigation();
  const prevented: boolean[] = [];
  let dismissed = 0;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NavigationContext.Provider value={navigation as unknown as NavigationProp<Record<string, object | undefined>>}>
      <ScreenRemovalPreventionSetterContext.Provider
        value={(_id, isPrevented) => {
          prevented.push(isPrevented);
        }}
      >
        {children}
      </ScreenRemovalPreventionSetterContext.Provider>
    </NavigationContext.Provider>
  );
  const hook = renderHook(
    (props: { open: boolean }) => {
      useDismissSearchOnBack(props.open, () => {
        dismissed += 1;
      });
    },
    { initialProps: { open }, wrapper },
  );
  return { navigation, prevented, dismissals: () => dismissed, ...hook };
}

it('dismisses search on platform back and stays on the pair', () => {
  const { navigation, prevented, dismissals } = renderBack(true);

  expect(prevented.at(-1)).toBe(true);

  act(() => {
    navigation.pressBack();
  });

  expect(dismissals()).toBe(1);
  expect(navigation.dispatched).toEqual([]);
});

it('lets back leave the symbol screen once search is closed', () => {
  const { navigation, prevented, dismissals, rerender } = renderBack(true);

  act(() => {
    navigation.pressBack();
  });
  rerender({ open: false });

  expect(prevented.at(-1)).toBe(false);

  act(() => {
    navigation.pressBack();
  });

  expect(dismissals()).toBe(1);
  expect(navigation.dispatched).toEqual([]);
});
