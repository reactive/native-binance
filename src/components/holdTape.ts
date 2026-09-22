export const PIN_SLOP = 4;

export type TapeHold = {
  held: readonly { a: number }[] | null;
};

export const idleTape: TapeHold = { held: null };

export type TapeEvent =
  | { type: 'scroll'; offset: number; live: readonly { a: number }[] }
  | { type: 'latest' };

/** Pinned follows the live tape. Scrolled away, the rendered array stays until the top. */
export function holdTape(state: TapeHold, event: TapeEvent): TapeHold {
  switch (event.type) {
    case 'latest':
      return state.held === null ? state : idleTape;
    case 'scroll':
      if (event.offset <= PIN_SLOP) return state.held === null ? state : idleTape;
      if (state.held) return state;
      return { held: event.live };
  }
}

export function hasNewTrades(
  held: readonly { a: number }[] | null,
  live: readonly { a: number }[],
): boolean {
  return held !== null && live[0] != null && live[0].a !== held[0]?.a;
}
