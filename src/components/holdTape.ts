export const PIN_SLOP = 4;

export type TapeHold<T extends { a: number }> = {
  held: readonly T[] | null;
};

export const idleTape: TapeHold<{ a: number }> = { held: null };

export type TapeEvent<T extends { a: number }> =
  | { type: 'scroll'; offset: number; live: readonly T[] }
  | { type: 'latest' };

/** Pinned follows the live tape. Scrolled away, the rendered array stays until the top. */
export function holdTape<T extends { a: number }>(
  state: TapeHold<T>,
  event: TapeEvent<T>,
): TapeHold<T> {
  switch (event.type) {
    case 'latest':
      return state.held === null ? state : { held: null };
    case 'scroll':
      if (event.offset <= PIN_SLOP) return state.held === null ? state : { held: null };
      if (state.held) return state;
      return { held: event.live };
  }
}

export function hasNewTrades<T extends { a: number }>(
  held: readonly T[] | null,
  live: readonly T[],
): boolean {
  return held !== null && live[0] != null && live[0].a !== held[0]?.a;
}
