export type HoldState = {
  committed: readonly string[] | null;
  holding: boolean;
  ready: boolean;
};

export const idleHold: HoldState = { committed: null, holding: false, ready: false };

export type HoldEvent =
  | { type: 'ready'; ids: readonly string[] }
  | { type: 'down' }
  | { type: 'up'; ids: readonly string[] }
  | { type: 'args'; ids: readonly string[]; ready: boolean };

/**
 * Volume order commits once quotes are in, stays put while a finger is down,
 * and applies again when the finger lifts or the quote/sort args change.
 */
export function holdOrder(state: HoldState, event: HoldEvent): HoldState {
  switch (event.type) {
    case 'down':
      return state.holding ? state : { ...state, holding: true };
    case 'up':
      if (!state.holding) return state;
      if (!state.ready) return { ...state, holding: false };
      return { holding: false, ready: true, committed: event.ids };
    case 'args':
      return {
        holding: false,
        ready: event.ready,
        committed: event.ready ? event.ids : null,
      };
    case 'ready':
      if (state.holding || state.ready) return state;
      return { holding: false, ready: true, committed: event.ids };
    default:
      return state;
  }
}
