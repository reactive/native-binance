import { usePreventRemove } from 'expo-router';

/**
 * While search is open, Android back and the iOS swipe dismiss it and stay on
 * this pair. `repeat` is not called, so the blocked removal does not continue.
 * A closed search does not register prevention, and back leaves the screen.
 */
export function useDismissSearchOnBack(open: boolean, dismiss: () => void): void {
  usePreventRemove(open, () => {
    dismiss();
  });
}
