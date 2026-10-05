import { Candle } from '../exchange/binance.js';
import { getLatestEMA } from '../indicators/ema.js';
import { getLatestRSI } from '../indicators/rsi.js';
import { getLatestMACD } from '../indicators/macd.js';
import { getLatestATR } from '../indicators/atr.js';
import { analyzeVolume } from '../indicators/volume.js';
import { calculateScore, ScoreBreakdown } from './scoring.js';
import { calculateRiskLevels } from '../risk/riskManager.js';
import { StrategyConfig } from '../config.js';

export type SignalType = 'BUY' | 'WATCH' | 'HOLD' | 'SELL';

export interface SignalResult {
  symbol: string;
  signal: SignalType;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskReward1: number;
  riskReward2: number;
  stopLossPercent: number;
  takeProfit1Percent: number;
  takeProfit2Percent: number;
  indicators: {
    price: number;
    emaFast: number;
    emaSlow: number;
    emaTrend: number;
    rsi: number;
    macd: {
      macd: number;
      signal: number;
      histogram: number;
    };
    atr: number;
    volume: {
      current: number;
      average: number;
      ratio: number;
    };
    breakout: boolean;
    resistance: number;
    support: number;
    isOversold: boolean;
    isOverbought: boolean;
  };
  timeframe: string;
  timestamp: number;
}

/**
 * Analyzes market data for a symbol and generates a trading signal
 */
export function generateSignal(
  symbol: string,
  candles: Candle[],
  timeframe: string,
  strategyConfig: StrategyConfig
): SignalResult {
  if (candles.length < strategyConfig.emaTrend + 1) {
    throw new Error(
      `Insufficient candles for ${symbol}. Required: at least ${strategyConfig.emaTrend + 1}, got ${candles.length}`
    );
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const currentCandle = candles[candles.length - 1];
  const currentPrice = currentCandle.close;

  // Calculate technical indicators
  const emaFast = getLatestEMA(closes, strategyConfig.emaFast);     // default 20
  const emaSlow = getLatestEMA(closes, strategyConfig.emaSlow);     // default 50
  const emaTrend = getLatestEMA(closes, strategyConfig.emaTrend);   // default 200
  const rsi = getLatestRSI(closes, strategyConfig.rsiPeriod);       // default 14
  const macd = getLatestMACD(closes, 12, 26, 9);
  const atr = getLatestATR(candles, strategyConfig.atrPeriod);       // default 14
  const volumeData = analyzeVolume(volumes, strategyConfig.volumePeriod); // default 20

  // Calculate 20-period support (lowest low of previous 20 candles)
  const lookback = 20;
  const previousCandles = candles.slice(-lookback - 1, -1);
  const support = previousCandles.length > 0 ? Math.min(...previousCandles.map(c => c.low)) : currentPrice * 0.95;

  // Compute multi-factor score
  const scoring = calculateScore({
    candles,
    emaFast,
    emaSlow,
    emaTrend,
    rsi,
    macd,
    volumeRatio: volumeData.volumeRatio
  });

  const score = scoring.totalScore;
  const buyThreshold = strategyConfig.buyThreshold || 75;

  // Minimum Confirmation check for BUY signal:
  // 1. EMA20 > EMA50
  // 2. Price > EMA20
  // 3. MACD Bullish (macd > signal AND histogram > 0)
  const isEmaBullish = emaFast > emaSlow;
  const isPriceAboveEmaFast = currentPrice > emaFast;
  const isMacdBullish = macd.macd > macd.signal && macd.histogram > 0;
  const hasMinimumConfirmation = isEmaBullish && isPriceAboveEmaFast && isMacdBullish;

  // SELL Confirmation check (Spot Exit / Stop Recommendation):
  // When price breaks down below EMA20 and EMA20 < EMA50 with bearish MACD
  const isEmaBearish = emaFast < emaSlow;
  const isPriceBelowEmaFast = currentPrice < emaFast;
  const isMacdBearish = macd.macd < macd.signal && macd.histogram < 0;
  const isStrongBearish = isEmaBearish && isPriceBelowEmaFast && isMacdBearish;

  let signal: SignalType = 'HOLD';

  if (score >= buyThreshold) {
    if (hasMinimumConfirmation) {
      signal = 'BUY';
    } else {
      // Downgrade to WATCH if minimum confirmation not met to reduce false positives
      signal = 'WATCH';
    }
  } else if (score >= 60) {
    signal = 'WATCH';
  } else {
    // Score < 60
    if (isStrongBearish && (currentPrice < support || score <= 25)) {
      signal = 'SELL';
    } else {
      signal = 'HOLD';
    }
  }

  // Calculate Risk Management levels
  const riskLevels = calculateRiskLevels(currentPrice, atr);

  return {
    symbol,
    signal,
    score,
    scoreBreakdown: scoring.breakdown,
    entryPrice: currentPrice,
    stopLoss: riskLevels.stopLoss,
    takeProfit1: riskLevels.takeProfit1,
    takeProfit2: riskLevels.takeProfit2,
    riskReward1: riskLevels.riskReward1,
    riskReward2: riskLevels.riskReward2,
    stopLossPercent: riskLevels.stopLossPercent,
    takeProfit1Percent: riskLevels.takeProfit1Percent,
    takeProfit2Percent: riskLevels.takeProfit2Percent,
    indicators: {
      price: currentPrice,
      emaFast,
      emaSlow,
      emaTrend,
      rsi,
      macd,
      atr,
      volume: {
        current: volumeData.currentVolume,
        average: volumeData.averageVolume,
        ratio: volumeData.volumeRatio
      },
      breakout: scoring.breakdown.breakout.isBreakout,
      resistance: scoring.breakdown.breakout.resistance,
      support,
      isOversold: scoring.breakdown.rsi.isOversold,
      isOverbought: scoring.breakdown.rsi.isOverbought
    },
    timeframe,
    timestamp: currentCandle.closeTime
  };
}
