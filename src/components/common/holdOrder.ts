export type HoldState = {
  committed: readonly string[] | null;
  holding: boolean;
  ready: boolean;
};

export const idleHold: HoldState = { committed: null, holding: false, ready: false };

export type HoldEvent =
  | { type: 'ready'; ids: readonly string[] }
  | { type: 'down'; ids: readonly string[] }
  | { type: 'up'; ids: readonly string[] }
  | { type: 'args'; ids: readonly string[]; ready: boolean };

/**
 * The ids on screen freeze when a finger goes down, including before the first
 * volume sort. That sort commits once the finger is up. Quote and sort changes
 * apply immediately.
 */
export function holdOrder(state: HoldState, event: HoldEvent): HoldState {
  switch (event.type) {
    case 'down':
      if (state.holding) return state;
      return {
        ...state,
        holding: true,
        committed: state.committed ?? event.ids,
      };
    case 'up':
      if (!state.holding) return state;
      if (!state.ready) return { ...state, holding: false, committed: null };
      return { holding: false, ready: true, committed: event.ids };
    case 'args':
      return {
        holding: false,
        ready: event.ready,
        committed: event.ready ? event.ids : null,
      };
    case 'ready':
      if (state.holding) return state.ready ? state : { ...state, ready: true };
      if (state.ready) return state;
      return { holding: false, ready: true, committed: event.ids };
  }
}
