import { calculateEMA } from './ema.js';

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * MACD (Moving Average Convergence Divergence)
 * Standard config: Fast = 12, Slow = 26, Signal = 9
 */
export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult[] {
  const result: MACDResult[] = [];
  const minRequired = slowPeriod + signalPeriod;

  if (closes.length < minRequired) {
    return result;
  }

  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  // MACD line = Fast EMA - Slow EMA
  const macdLine: number[] = new Array(closes.length).fill(NaN);
  for (let i = slowPeriod - 1; i < closes.length; i++) {
    macdLine[i] = fastEMA[i] - slowEMA[i];
  }

  // Extract non-NaN portion of MACD line to calculate Signal line
  const validMacdStartIndex = slowPeriod - 1;
  const validMacdValues = macdLine.slice(validMacdStartIndex);
  const signalValues = calculateEMA(validMacdValues, signalPeriod);

  for (let i = 0; i < closes.length; i++) {
    if (i < validMacdStartIndex) {
      result.push({ macd: NaN, signal: NaN, histogram: NaN });
    } else {
      const signalIdx = i - validMacdStartIndex;
      const m = macdLine[i];
      const s = signalValues[signalIdx];
      const h = !isNaN(m) && !isNaN(s) ? m - s : NaN;
      result.push({ macd: m, signal: s, histogram: h });
    }
  }

  return result;
}

export function getLatestMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const macdSeries = calculateMACD(closes, fastPeriod, slowPeriod, signalPeriod);
  if (macdSeries.length === 0) {
    throw new Error(`Insufficient data for MACD. Required at least ${slowPeriod + signalPeriod}, got ${closes.length}`);
  }

  const latest = macdSeries[macdSeries.length - 1];
  if (isNaN(latest.macd) || isNaN(latest.signal) || isNaN(latest.histogram)) {
    throw new Error(`MACD result contains NaN for latest closed candle.`);
  }

  return latest;
}
