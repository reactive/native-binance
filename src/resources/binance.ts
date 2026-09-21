export const BINANCE_REST = 'https://data-api.binance.vision/api/v3';

/** Binance rejects CORS preflight when GET sends Content-Type. */
export function binanceGetInit(this: { signal?: AbortSignal }) {
  return { method: 'GET' as const, signal: this.signal };
}
