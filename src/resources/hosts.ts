import { RestEndpoint, type RestGenerics } from '@data-client/rest';

export const BINANCE_REST = 'https://data-api.binance.vision/api/v3';
export const BINANCE_STREAM = 'wss://data-stream.binance.vision/ws';

/** Binance rejects the CORS preflight that a JSON Content-Type triggers on GET. */
function binanceGetInit(this: { signal?: AbortSignal }) {
  return { method: 'GET' as const, signal: this.signal, cache: 'no-store' as const };
}

/** A failed refresh keeps the last good read. With no stored response, the error still throws. */
function keepLastRead(): 'soft' {
  return 'soft';
}

/** Every public GET. Does not set a host: a class-field prefix cannot be replaced. */
export class BinanceGet<O extends RestGenerics = any> extends RestEndpoint<O> {
  getRequestInit() {
    return binanceGetInit.call(this);
  }

  errorPolicy(_error: unknown) {
    return keepLastRead();
  }
}

/** The five market reads. Asset list and token info extend `BinanceGet` only. */
export class VisionEndpoint<O extends RestGenerics = any> extends BinanceGet<O> {
  urlPrefix = BINANCE_REST;
}
