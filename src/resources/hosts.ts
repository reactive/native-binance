export const BINANCE_REST = 'https://data-api.binance.vision/api/v3';
export const BINANCE_STREAM = 'wss://data-stream.binance.vision/ws';

/** Binance rejects the CORS preflight that a JSON Content-Type triggers on GET. */
export function binanceGetInit(this: { signal?: AbortSignal }) {
  return { method: 'GET' as const, signal: this.signal, cache: 'no-store' as const };
}

/** A failed refresh keeps the last good read. With no stored response, the error still throws. */
export function keepLastRead(): 'soft' {
  return 'soft';
}
