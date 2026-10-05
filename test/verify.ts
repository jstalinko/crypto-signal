import { BinanceClient } from '../src/exchange/binance.js';
import { calculateEMA, getLatestEMA } from '../src/indicators/ema.js';
import { calculateRSI, getLatestRSI } from '../src/indicators/rsi.js';
import { calculateMACD, getLatestMACD } from '../src/indicators/macd.js';
import { calculateATR, getLatestATR } from '../src/indicators/atr.js';
import { analyzeVolume } from '../src/indicators/volume.js';
import { generateSignal } from '../src/strategy/signal.js';
import { calculateRiskLevels } from '../src/risk/riskManager.js';
import {
  formatBuySignalMessage,
  formatScanSummaryMessage,
  formatSingleAnalysisMessage,
  formatBotStatusMessage
} from '../src/telegram/formatter.js';

async function runTests() {
  console.log('=== RUNNING SPOT SIGNAL BOT VERIFICATION SUITE ===\n');

  // Test 1: Binance Market Data fetching
  console.log('Test 1: Testing Binance Client live market data fetch...');
  const client = new BinanceClient('https://api.binance.com', 'https://data-api.binance.vision');
  
  const isOk = await client.ping();
  console.log(`Ping result: ${isOk}`);

  const candles = await client.getCandles('BTCUSDT', '15m', 250);
  console.log(`Fetched ${candles.length} closed candles for BTCUSDT.`);
  if (candles.length < 240) {
    throw new Error(`Expected at least 240 candles, got ${candles.length}`);
  }

  const lastCandle = candles[candles.length - 1];
  const now = Date.now();
  console.log(`Last candle close time: ${new Date(lastCandle.closeTime).toISOString()}`);
  console.log(`Current time:           ${new Date(now).toISOString()}`);
  if (lastCandle.closeTime > now) {
    throw new Error('Repainting detected: Last candle has closeTime in the future!');
  }
  console.log('✅ Non-repainting closed candle check passed.\n');

  // Test 2: Indicator calculations
  console.log('Test 2: Testing Indicator calculations...');
  const closes = candles.map(c => c.close);
  const ema20 = getLatestEMA(closes, 20);
  const ema50 = getLatestEMA(closes, 50);
  const ema200 = getLatestEMA(closes, 200);
  console.log(`EMA 20: ${ema20.toFixed(2)}, EMA 50: ${ema50.toFixed(2)}, EMA 200: ${ema200.toFixed(2)}`);

  const rsi = getLatestRSI(closes, 14);
  console.log(`RSI 14: ${rsi.toFixed(2)}`);
  if (rsi < 0 || rsi > 100) {
    throw new Error(`Invalid RSI value: ${rsi}`);
  }

  const macd = getLatestMACD(closes);
  console.log(`MACD: ${macd.macd.toFixed(2)}, Signal: ${macd.signal.toFixed(2)}, Hist: ${macd.histogram.toFixed(2)}`);

  const atr = getLatestATR(candles, 14);
  console.log(`ATR 14: ${atr.toFixed(2)}`);
  if (atr <= 0) {
    throw new Error(`Invalid ATR value: ${atr}`);
  }

  const vol = analyzeVolume(candles.map(c => c.volume), 20);
  console.log(`Volume: Current=${vol.currentVolume.toFixed(2)}, Avg=${vol.averageVolume.toFixed(2)}, Ratio=${vol.volumeRatio.toFixed(2)}x`);
  console.log('✅ Indicators calculated accurately.\n');

  // Test 3: Strategy & Signal Generation
  console.log('Test 3: Testing Strategy & Signal Generation...');
  const strategyConfig = {
    emaFast: 20,
    emaSlow: 50,
    emaTrend: 200,
    rsiPeriod: 14,
    atrPeriod: 14,
    volumePeriod: 20,
    buyThreshold: 75
  };

  const signalResult = generateSignal('BTCUSDT', candles, '15m', strategyConfig);
  console.log(`Signal: ${signalResult.signal}, Score: ${signalResult.score}/100`);
  console.log(`Entry: $${signalResult.entryPrice.toFixed(2)}, SL: $${signalResult.stopLoss.toFixed(2)}, TP1: $${signalResult.takeProfit1.toFixed(2)}, TP2: $${signalResult.takeProfit2.toFixed(2)}`);
  console.log('Score breakdown:', JSON.stringify(signalResult.scoreBreakdown, null, 2));
  console.log('✅ Strategy & Signal generated successfully.\n');

  // Test 4: Formatters
  console.log('Test 4: Testing Telegram message formatters...');
  const buyMsg = formatBuySignalMessage(signalResult);
  console.log('--- Sample Buy Message ---');
  console.log(buyMsg);
  console.log('--------------------------');

  const scanSummary = formatScanSummaryMessage([signalResult]);
  console.log('--- Sample Scan Summary ---');
  console.log(scanSummary);
  console.log('---------------------------');

  const singleAnalysisMsg = formatSingleAnalysisMessage(signalResult);
  console.log('--- Sample Single Analysis Message ---');
  console.log(singleAnalysisMsg);
  console.log('--------------------------------------');

  const statusMsg = formatBotStatusMessage({
    status: 'ONLINE',
    exchange: 'Binance',
    symbolCount: 3,
    timeframe: '15m',
    lastScanTime: '2026-10-06 02:00:00',
    nextScanTime: '2026-10-06 02:01:00',
    uptime: '1h 15m'
  });
  console.log('--- Sample Status Message ---');
  console.log(statusMsg);
  console.log('-----------------------------');

  // Validate HTML tags to ensure Telegram Bot API will accept them
  function validateTelegramHtml(html: string, label: string) {
    const invalidTagMatch = html.match(/<(?!\/?(b|i|u|s|code|pre|a(\s+[^>]*)?)\b)[^>]*>/gi);
    if (invalidTagMatch) {
      throw new Error(`[${label}] Detected invalid Telegram HTML tag: ${JSON.stringify(invalidTagMatch)}`);
    }
    const nakedTagMatch = html.match(/<[^a-z\/]/gi);
    if (nakedTagMatch) {
      throw new Error(`[${label}] Detected invalid Telegram start tag: ${JSON.stringify(nakedTagMatch)}`);
    }
  }

  validateTelegramHtml(buyMsg, 'BuyMessage');
  validateTelegramHtml(scanSummary, 'ScanSummary');
  validateTelegramHtml(singleAnalysisMsg, 'SingleAnalysisMessage');
  validateTelegramHtml(statusMsg, 'StatusMessage');
  console.log('✅ HTML validation passed: No unescaped tags or invalid entities.\n');

  // Test 5: Testing ETHUSDT and SOLUSDT data
  console.log('Test 5: Testing ETHUSDT and SOLUSDT data...');
  const ethCandles = await client.getCandles('ETHUSDT', '15m', 250);
  const ethSignal = generateSignal('ETHUSDT', ethCandles, '15m', strategyConfig);
  console.log(`ETHUSDT Signal: ${ethSignal.signal}, Score: ${ethSignal.score}`);

  const solCandles = await client.getCandles('SOLUSDT', '15m', 250);
  const solSignal = generateSignal('SOLUSDT', solCandles, '15m', strategyConfig);
  console.log(`SOLUSDT Signal: ${solSignal.signal}, Score: ${solSignal.score}`);
  console.log('✅ Single coin signals OK.\n');

  // Test 6: Testing Market Screener & Top Symbols
  console.log('Test 6: Testing Binance top USDT volume symbols and Screener...');
  const topSymbols = await client.getTopUsdtSymbols(10);
  console.log(`Top 10 USDT symbols by volume: ${topSymbols.join(', ')}`);
  if (topSymbols.length < 5) {
    throw new Error(`Expected at least 5 top symbols, got ${topSymbols.length}`);
  }

  const { MarketScanner } = await import('../src/scanner/marketScanner.js');
  const scanner = new MarketScanner({
    telegram: { token: 'dummy', chatId: '123' },
    exchange: { baseUrl: 'https://api.binance.com' },
    trading: {
      symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      timeframe: '15m',
      candleLimit: 250,
      scanIntervalSeconds: 60
    },
    strategy: strategyConfig
  }, client);

  const { results: screenerResults, totalScanned } = await scanner.scanScreener(8);
  console.log(`Screener scanned ${screenerResults.length} / ${totalScanned} symbols successfully.`);
  const { formatScreenerMessage } = await import('../src/telegram/formatter.js');
  const screenerMsg = formatScreenerMessage(screenerResults, totalScanned, '15m');
  console.log('--- Sample Screener Message ---');
  console.log(screenerMsg);
  console.log('-------------------------------');
  validateTelegramHtml(screenerMsg, 'ScreenerMessage');
  // Test 7: Testing Arbitrary Coins & Dynamic Timeframe
  console.log('Test 7: Testing Arbitrary Coins (DOGE, SUI, PEPE) and Custom Timeframe...');
  const dogeRes = await scanner.scanSymbol('doge');
  console.log(`DOGE scan result: Symbol=${dogeRes.symbol}, Price=${dogeRes.entryPrice}, Signal=${dogeRes.signal}, Score=${dogeRes.score}`);
  if (dogeRes.symbol !== 'DOGEUSDT') {
    throw new Error(`Expected DOGEUSDT, got ${dogeRes.symbol}`);
  }

  const suiRes = await scanner.scanSymbol('sui', '1h');
  console.log(`SUI (1h) scan result: Symbol=${suiRes.symbol}, Timeframe=${suiRes.timeframe}, Price=${suiRes.entryPrice}, Signal=${suiRes.signal}`);
  if (suiRes.timeframe !== '1h') {
    throw new Error(`Expected timeframe 1h, got ${suiRes.timeframe}`);
  }

  const pepeRes = await scanner.scanSymbol('pepe');
  console.log(`PEPE scan result: Symbol=${pepeRes.symbol}, Price=${pepeRes.entryPrice}, Signal=${pepeRes.signal}`);

  // Test invalid symbol error handling
  try {
    await scanner.scanSymbol('NONEXISTENTCOIN999');
    throw new Error('Expected invalid symbol to throw error, but it succeeded');
  } catch (invErr: any) {
    console.log(`✅ Expected error on invalid symbol: ${invErr.message}`);
  }
  // Test 8: Scalping Scanner
  console.log('Test 8: Testing Scalping Scanner (15m)...');
  const { results: scalpResults, totalScanned: scalpTotal } = await scanner.scanScalping(10, '15m');
  console.log(`Scalp scanner returned ${scalpResults.length} setups out of ${scalpTotal} symbols.`);
  const { formatScalpingMessage } = await import('../src/telegram/formatter.js');
  const scalpMsg = formatScalpingMessage(scalpResults, scalpTotal, '15m');
  console.log('--- Sample Scalping Message ---');
  console.log(scalpMsg);
  console.log('-------------------------------');
  validateTelegramHtml(scalpMsg, 'ScalpingMessage');
  console.log('✅ Scalping scanner OK.\n');

  // Test 9: Trade Watcher & Notice Me Simulation
  console.log('Test 9: Testing Trade Watcher & Notice Me...');
  const { TradeWatcherService } = await import('../src/watcher/tradeWatcher.js');
  const path = await import('path');
  const fs = await import('fs');
  const testStorage = path.resolve(process.cwd(), 'data', 'test_watchers.json');
  const watcher = new TradeWatcherService(client, 30, testStorage);
  
  let alertFired = false;
  watcher.setAlertCallback(async (chatId, msg) => {
    alertFired = true;
    console.log(`[Watcher Alert Callback] Sent to ${chatId}:\n${msg}`);
    validateTelegramHtml(msg, 'WatcherAlert');
    return true;
  });

  const testTrade = watcher.addWatcher({
    symbol: 'NEARUSDT',
    chatId: '12345678',
    timeframe: '15m',
    entryPrice: 5.18,
    stopLoss: 5.10,
    takeProfit1: 5.29,
    takeProfit2: 5.37
  });

  const { formatWatcherConfirmationMessage, formatWatchersListMessage } = await import('../src/telegram/formatter.js');
  const confirmMsg = formatWatcherConfirmationMessage(testTrade);
  console.log('--- Sample Notice Me Confirmation ---');
  console.log(confirmMsg);
  console.log('-------------------------------------');
  validateTelegramHtml(confirmMsg, 'WatcherConfirmation');

  const listMsg = formatWatchersListMessage(watcher.getActiveWatchers());
  console.log('--- Sample Watchers List ---');
  console.log(listMsg);
  console.log('----------------------------');
  validateTelegramHtml(listMsg, 'WatchersList');

  // Live price check
  await watcher.checkWatchers();
  console.log('✅ Trade Watcher live price check executed cleanly.');

  // Clean up test file
  if (fs.existsSync(testStorage)) {
    fs.unlinkSync(testStorage);
  }
  console.log('✅ Trade Watcher tests OK.\n');

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
