export interface RiskLevels {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  risk: number;
  riskReward1: number;
  riskReward2: number;
  stopLossPercent: number;
  takeProfit1Percent: number;
  takeProfit2Percent: number;
}

/**
 * Calculates Spot Risk Levels based on Entry Price and ATR
 * Stop Loss = entry - (ATR * 1.5)
 * TP1 = entry + (risk * 1.5)
 * TP2 = entry + (risk * 2.5)
 */
export function calculateRiskLevels(entryPrice: number, atr: number): RiskLevels {
  if (entryPrice <= 0) {
    throw new Error(`Invalid entry price: ${entryPrice}`);
  }

  // SL: entry - (ATR * 1.5)
  const stopLoss = Math.max(0, entryPrice - (atr * 1.5));
  const risk = entryPrice - stopLoss;

  // TP: R:R 1:1.5 and 1:2.5
  const takeProfit1 = entryPrice + (risk * 1.5);
  const takeProfit2 = entryPrice + (risk * 2.5);

  const stopLossPercent = ((entryPrice - stopLoss) / entryPrice) * 100;
  const takeProfit1Percent = ((takeProfit1 - entryPrice) / entryPrice) * 100;
  const takeProfit2Percent = ((takeProfit2 - entryPrice) / entryPrice) * 100;

  return {
    entry: entryPrice,
    stopLoss,
    takeProfit1,
    takeProfit2,
    risk,
    riskReward1: 1.5,
    riskReward2: 2.5,
    stopLossPercent,
    takeProfit1Percent,
    takeProfit2Percent
  };
}

/**
 * Format price cleanly according to magnitude
 * e.g. $85,450.25 vs $0.000452 vs $0.00000852
 */
export function formatPrice(price: number): string {
  if (price === 0) return '$0.00';
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (price >= 1) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  } else if (price >= 0.001) {
    return `$${price.toFixed(5)}`;
  } else if (price >= 0.00001) {
    return `$${price.toFixed(7)}`;
  } else {
    return `$${price.toFixed(8)}`;
  }
}
