import { Candle } from '../exchange/binance.js';
import { MACDResult } from '../indicators/macd.js';

export interface ScoreBreakdown {
  ema: {
    score: number;
    max: number;
    description: string;
  };
  rsi: {
    score: number;
    max: number;
    value: number;
    isOverbought: boolean;
    isOversold: boolean;
    description: string;
  };
  macd: {
    score: number;
    max: number;
    isBullish: boolean;
    description: string;
  };
  volume: {
    score: number;
    max: number;
    ratio: number;
    description: string;
  };
  breakout: {
    score: number;
    max: number;
    isBreakout: boolean;
    resistance: number;
    description: string;
  };
}

export interface ScoringResult {
  totalScore: number;
  breakdown: ScoreBreakdown;
}

export interface IndicatorData {
  candles: Candle[];
  emaFast: number;  // 20
  emaSlow: number;  // 50
  emaTrend: number; // 200
  rsi: number;      // 14
  macd: MACDResult; // 12, 26, 9
  volumeRatio: number;
}

/**
 * Calculates Strategy Scoring (0 - 100) based on multiple technical indicators
 */
export function calculateScore(data: IndicatorData): ScoringResult {
  const { candles, emaFast, emaSlow, emaTrend, rsi, macd, volumeRatio } = data;
  const currentCandle = candles[candles.length - 1];

  // 1. EMA Trend Scoring (Max 25)
  let emaScore = 0;
  let emaDesc = 'Bearish';
  if (emaFast > emaSlow && emaSlow > emaTrend) {
    emaScore = 25;
    emaDesc = 'Strong Bullish (EMA20 > EMA50 > EMA200)';
  } else if (emaFast > emaSlow) {
    emaScore = 15;
    emaDesc = 'Bullish (EMA20 > EMA50)';
  } else {
    emaScore = 0;
    emaDesc = 'Bearish (EMA20 <= EMA50)';
  }

  // 2. RSI Scoring (Max 15)
  let rsiScore = 0;
  let isOverbought = false;
  let isOversold = false;
  let rsiDesc = '';

  if (rsi >= 50 && rsi <= 65) {
    rsiScore = 15;
    rsiDesc = 'Bullish Ideal (50-65)';
  } else if (rsi > 65 && rsi <= 70) {
    rsiScore = 10;
    rsiDesc = 'Bullish Strong (65-70)';
  } else if (rsi >= 40 && rsi < 50) {
    rsiScore = 5;
    rsiDesc = 'Neutral / Recovering (40-50)';
  } else if (rsi > 70) {
    rsiScore = 0;
    isOverbought = true;
    rsiDesc = 'Overbought (>70)';
  } else if (rsi < 30) {
    rsiScore = 0;
    isOversold = true;
    rsiDesc = 'Oversold (<30)';
  } else {
    rsiScore = 0;
    rsiDesc = 'Bearish (30-40)';
  }

  // 3. MACD Scoring (Max 20)
  let macdScore = 0;
  let macdBullish = false;
  let macdDesc = '';

  if (macd.macd > macd.signal && macd.histogram > 0) {
    macdScore = 20;
    macdBullish = true;
    macdDesc = 'Bullish (MACD > Signal & Hist > 0)';
  } else if (macd.macd > macd.signal) {
    macdScore = 10;
    macdBullish = true;
    macdDesc = 'Weak Bullish (MACD > Signal, Hist <= 0)';
  } else {
    macdScore = 0;
    macdBullish = false;
    macdDesc = 'Bearish (MACD <= Signal)';
  }

  // 4. Volume Scoring (Max 20)
  let volumeScore = 0;
  let volumeDesc = '';

  if (volumeRatio >= 1.5) {
    volumeScore = 20;
    volumeDesc = `High Volume Surge (${volumeRatio.toFixed(2)}x >= 1.5x)`;
  } else if (volumeRatio >= 1.2) {
    volumeScore = 10;
    volumeDesc = `Moderate Volume Surge (${volumeRatio.toFixed(2)}x >= 1.2x)`;
  } else {
    volumeScore = 0;
    volumeDesc = `Normal / Low Volume (${volumeRatio.toFixed(2)}x < 1.2x)`;
  }

  // 5. Breakout Detection (Max 20)
  // Look back at the last 20 candles before the current closed candle to find resistance
  const lookback = 20;
  const previousCandles = candles.slice(-lookback - 1, -1);
  let resistance = 0;
  let isBreakout = false;
  let breakoutScore = 0;
  let breakoutDesc = '';

  if (previousCandles.length > 0) {
    resistance = Math.max(...previousCandles.map(c => c.high));
    if (currentCandle.close > resistance) {
      breakoutScore = 20;
      isBreakout = true;
      breakoutDesc = `Confirmed Breakout above resistance $${resistance.toFixed(2)}`;
    } else if (currentCandle.close >= resistance * 0.998) {
      breakoutScore = 10;
      breakoutDesc = `Testing resistance level $${resistance.toFixed(2)}`;
    } else {
      breakoutScore = 0;
      breakoutDesc = `Below resistance $${resistance.toFixed(2)}`;
    }
  } else {
    breakoutDesc = 'Insufficient data for breakout analysis';
  }

  const rawTotal = emaScore + rsiScore + macdScore + volumeScore + breakoutScore;
  const totalScore = Math.min(100, Math.max(0, rawTotal));

  return {
    totalScore,
    breakdown: {
      ema: { score: emaScore, max: 25, description: emaDesc },
      rsi: { score: rsiScore, max: 15, value: rsi, isOverbought, isOversold, description: rsiDesc },
      macd: { score: macdScore, max: 20, isBullish: macdBullish, description: macdDesc },
      volume: { score: volumeScore, max: 20, ratio: volumeRatio, description: volumeDesc },
      breakout: { score: breakoutScore, max: 20, isBreakout, resistance, description: breakoutDesc }
    }
  };
}
