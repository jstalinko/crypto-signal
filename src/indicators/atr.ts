import { Candle } from '../exchange/binance.js';

/**
 * Average True Range (ATR) with Wilder's Smoothing
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);

  if (candles.length <= period) {
    return result;
  }

  // Calculate True Range (TR) for all candles
  const tr: number[] = new Array(candles.length);
  tr[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const hl = high - low;
    const hpc = Math.abs(high - prevClose);
    const lpc = Math.abs(low - prevClose);

    tr[i] = Math.max(hl, hpc, lpc);
  }

  // First ATR is the simple average of the first `period` TRs
  let sumTR = 0;
  for (let i = 0; i < period; i++) {
    sumTR += tr[i];
  }
  let prevATR = sumTR / period;
  result[period - 1] = prevATR;

  // Wilder's smoothing for subsequent values
  for (let i = period; i < candles.length; i++) {
    const currentATR = (prevATR * (period - 1) + tr[i]) / period;
    result[i] = currentATR;
    prevATR = currentATR;
  }

  return result;
}

export function getLatestATR(candles: Candle[], period: number = 14): number {
  const atrSeries = calculateATR(candles, period);
  const latest = atrSeries[atrSeries.length - 1];
  if (isNaN(latest)) {
    throw new Error(`Insufficient data for ATR-${period}. Required: ${period + 1}, available: ${candles.length}`);
  }
  return latest;
}
