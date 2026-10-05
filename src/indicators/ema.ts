/**
 * Exponential Moving Average (EMA)
 */

export function calculateEMA(data: number[], period: number): number[] {
  if (data.length < period) {
    return new Array(data.length).fill(NaN);
  }

  const result: number[] = new Array(data.length).fill(NaN);
  const k = 2 / (period + 1);

  // Initial SMA of the first `period` elements
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  let prevEMA = sum / period;
  result[period - 1] = prevEMA;

  // Calculate subsequent EMA values
  for (let i = period; i < data.length; i++) {
    const currentEMA = (data[i] - prevEMA) * k + prevEMA;
    result[i] = currentEMA;
    prevEMA = currentEMA;
  }

  return result;
}

export function getLatestEMA(data: number[], period: number): number {
  const emaSeries = calculateEMA(data, period);
  const latest = emaSeries[emaSeries.length - 1];
  if (isNaN(latest)) {
    throw new Error(`Insufficient data to calculate EMA-${period}. Required: ${period}, available: ${data.length}`);
  }
  return latest;
}
