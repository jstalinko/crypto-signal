/**
 * Relative Strength Index (RSI) using Wilder's Smoothing Method
 */

export function calculateRSI(closes: number[], period: number = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) {
    return result;
  }

  let gains = 0;
  let losses = 0;

  // First period changes
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  if (avgLoss === 0) {
    result[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    result[period] = 100 - (100 / (1 + rs));
  }

  // Subsequent Wilder's smoothed values
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - (100 / (1 + rs));
    }
  }

  return result;
}

export function getLatestRSI(closes: number[], period: number = 14): number {
  const rsiSeries = calculateRSI(closes, period);
  const latest = rsiSeries[rsiSeries.length - 1];
  if (isNaN(latest)) {
    throw new Error(`Insufficient data to calculate RSI-${period}. Required: ${period + 1}, available: ${closes.length}`);
  }
  return latest;
}
