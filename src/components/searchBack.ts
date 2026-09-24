import { usePreventRemove } from 'expo-router';

/**
 * While search is open, the iOS swipe, Android back, and the browser back
 * button dismiss it and stay on this pair. The blocked action is not repeated.
 *
 * Choosing a symbol uses `router.setParams`, which keeps this route, so this
 * hook does not return `disablePrevention`. Clearing prevention and then
 * replacing the route in the same turn still sees the previous render, and
 * the choice is swallowed.
 */
export function useDismissSearchOnBack(open: boolean, dismiss: () => void): void {
  usePreventRemove(open, () => {
    dismiss();
  });
}
