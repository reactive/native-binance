import { usePreventRemove } from 'expo-router';

/**
 * While search is open, Android back and the iOS swipe dismiss it and stay on
 * this pair. `repeat` is not called, so the blocked removal does not continue.
 * A closed search does not register prevention, and back leaves the screen.
 *
 * The returned function turns prevention off immediately. Choosing another
 * symbol calls it before `router.replace`, while search is still open.
 */
export function useDismissSearchOnBack(open: boolean, dismiss: () => void): () => void {
  return usePreventRemove(open, () => {
    dismiss();
  });
}

/** Close search. A different symbol replaces this screen after prevention is off. */
export function goToSymbol(
  current: string,
  next: string,
  close: () => void,
  release: () => void,
  replace: (path: `/symbol/${string}`) => void,
): void {
  close();
  if (next === current) return;
  release();
  replace(`/symbol/${next}`);
}
