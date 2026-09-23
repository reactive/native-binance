import { Easing } from 'react-native';

import { INTERVALS, type CandleInterval } from '@/resources/Candle';

export const FADE_OUT_MS = 90;
export const FADE_IN_MS = 180;
export const CAPTION_DELAY_MS = 400;
export const CAPTION_MIN_MS = 300;
export const FAILURE_MS = 10_000;

/** Outgoing series. cubic-bezier(0.4, 0, 1, 1). */
export const easeOut = Easing.bezier(0.4, 0, 1, 1);
/** Incoming series. cubic-bezier(0, 0, 0.2, 1). */
export const easeIn = Easing.bezier(0, 0, 0.2, 1);

const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export function intervalMs(interval: CandleInterval): number {
  return INTERVAL_MS[interval];
}

export function intervalLabel(interval: CandleInterval): string {
  return INTERVALS.find(item => item.value === interval)?.label ?? interval;
}

/** Binance aligns 1m–1d to UTC, which is floor on the unix epoch. */
export function periodStart(now: number, interval: CandleInterval): number {
  const ms = INTERVAL_MS[interval];
  return Math.floor(now / ms) * ms;
}

type CandleMeta = { error?: unknown; expiresAt: number } | undefined;

/**
 * A stored list is ready only when it has no error, has not expired, and its
 * newest candle is the current period. An empty list is a series.
 */
export function cachedListReady(
  meta: CandleMeta,
  candles: readonly { openTime: number }[] | undefined,
  now: number,
  interval: CandleInterval,
): boolean {
  if (!meta || meta.error != null) return false;
  if (!(now <= meta.expiresAt)) return false;
  if (!candles) return false;
  if (candles.length === 0) return true;
  const newest = candles[candles.length - 1].openTime;
  return newest >= periodStart(now, interval);
}

/**
 * When the next series may start fading in.
 * Arrivals before the caption stay on the fade-out clock.
 * Arrivals while the caption is up wait out its 300ms minimum.
 */
export function revealAt(
  waitStartedAt: number | null,
  readyAt: number,
  fadeOutDoneAt: number,
): number {
  const earliest = Math.max(readyAt, fadeOutDoneAt);
  if (waitStartedAt == null) return earliest;
  const captionAt = waitStartedAt + CAPTION_DELAY_MS;
  if (readyAt < captionAt) return earliest;
  return Math.max(earliest, captionAt + CAPTION_MIN_MS);
}
