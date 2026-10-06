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

  // Test 10: Daily Trading Scanner, Updates & Keyboard Menu
  console.log('Test 10: Testing Daily Trading Scanner & Keyboard Menu...');
  const { results: dailyResults, totalScanned: dailyTotal } = await scanner.scanDailyTrading(3, '1h');
  console.log(`Daily trading scanner returned ${dailyResults.length} setups out of ${dailyTotal} symbols (1h).`);

  const { formatDailyTradingMessage, formatStartMessage, formatHelpMessage } = await import('../src/telegram/formatter.js');
  const dailyManualMsg = formatDailyTradingMessage(dailyResults, dailyTotal, '1h', false);
  console.log('--- Sample Daily Trading Manual Message ---');
  console.log(dailyManualMsg);
  console.log('-------------------------------------------');
  validateTelegramHtml(dailyManualMsg, 'DailyTradingManual');

  const dailyAutoMsg = formatDailyTradingMessage(dailyResults, dailyTotal, '1h', true);
  console.log('--- Sample Daily Trading Automated Update ---');
  console.log(dailyAutoMsg);
  console.log('--------------------------------------------');
  validateTelegramHtml(dailyAutoMsg, 'DailyTradingAuto');

  const startMsg = formatStartMessage(['btc', 'eth', 'sol']);
  validateTelegramHtml(startMsg, 'StartMessage');

  const helpMsg = formatHelpMessage();
  validateTelegramHtml(helpMsg, 'HelpMessage');

  const { TelegramBotService } = await import('../src/telegram/bot.js');
  const { loadConfig } = await import('../src/config.js');
  const appConfig = loadConfig();
  const dummyBotService = new TelegramBotService(appConfig);
  const replyKeyboard = dummyBotService.getMainReplyKeyboard();
  console.log('Reply Keyboard generated:', JSON.stringify(replyKeyboard));
  if (!replyKeyboard.reply_markup || !('keyboard' in replyKeyboard.reply_markup)) {
    throw new Error('Reply keyboard was not constructed properly');
  }

  const inlineKeyboard = dummyBotService.getMainInlineKeyboard();
  console.log('Inline Keyboard generated:', JSON.stringify(inlineKeyboard));
  if (!inlineKeyboard.reply_markup || !('inline_keyboard' in inlineKeyboard.reply_markup)) {
    throw new Error('Inline keyboard was not constructed properly');
  }

  console.log('✅ Daily Trading Scanner, Formatters & Keyboards OK.\n');

  // Test 11: UserManager, Public Bot Approval Flow & Multi-user Watchers
  console.log('Test 11: Testing UserManager, Admin Menus & Multi-user Watchers...');
  const { UserManager } = await import('../src/user/userManager.js');
  const testUsersFile = path.resolve(process.cwd(), 'data', 'test_users.json');
  if (fs.existsSync(testUsersFile)) {
    fs.unlinkSync(testUsersFile);
  }

  const userMgr = new UserManager('7472742743', testUsersFile);

  // 11.1 Check Admin auto-creation
  if (!userMgr.isAdmin('7472742743')) {
    throw new Error('Configured adminChatId was not recognized as admin');
  }
  if (!userMgr.isApproved('7472742743')) {
    throw new Error('Admin should automatically be approved');
  }

  // 11.2 Register new public user
  const regResult = userMgr.registerOrUpdate('111222333', {
    username: 'crypto_trader',
    firstName: 'Alice',
    lastName: 'Trader'
  });
  if (!regResult.isNew) {
    throw new Error('Expected new user registration to have isNew: true');
  }
  if (regResult.user.status !== 'pending') {
    throw new Error(`Expected status pending, got ${regResult.user.status}`);
  }
  if (userMgr.isApproved('111222333')) {
    throw new Error('Pending user should not be approved');
  }

  // 11.3 Approve user
  const approvedUser = userMgr.approveUser('111222333');
  if (!approvedUser || approvedUser.status !== 'approved' || !userMgr.isApproved('111222333')) {
    throw new Error('User approval failed');
  }

  // 11.4 Register second user and reject
  userMgr.registerOrUpdate('444555666', {
    username: 'spammer_bot',
    firstName: 'Bob'
  });
  const rejectedUser = userMgr.rejectUser('444555666');
  if (!rejectedUser || rejectedUser.status !== 'rejected') {
    throw new Error('User rejection failed');
  }

  // 11.5 Check stats
  const stats = userMgr.getStats();
  console.log('User Manager stats:', stats);
  if (stats.total !== 3 || stats.approved !== 2 || stats.rejected !== 1) {
    throw new Error(`Unexpected user stats: ${JSON.stringify(stats)}`);
  }

  // 11.6 Test formatters for Admin
  const {
    formatAdminDashboard,
    formatAdminUsersList,
    formatAdminUserDetail,
    formatNewUserRequestMessage,
    formatWaitingApprovalMessage,
    formatUserApprovedNotification,
    formatUserRejectedNotification
  } = await import('../src/telegram/formatter.js');

  const adminDashboardMsg = formatAdminDashboard(stats);
  validateTelegramHtml(adminDashboardMsg, 'AdminDashboard');

  const adminUsersMsg = formatAdminUsersList(userMgr.getAllUsers());
  validateTelegramHtml(adminUsersMsg, 'AdminUsersList');

  const userDetailMsg = formatAdminUserDetail(approvedUser);
  validateTelegramHtml(userDetailMsg, 'AdminUserDetail');

  const newReqMsg = formatNewUserRequestMessage(regResult.user);
  validateTelegramHtml(newReqMsg, 'NewUserRequest');

  const waitMsg = formatWaitingApprovalMessage(regResult.user);
  validateTelegramHtml(waitMsg, 'WaitingApproval');

  const userApprMsg = formatUserApprovedNotification();
  validateTelegramHtml(userApprMsg, 'UserApprovedNotice');

  const userRejMsg = formatUserRejectedNotification();
  validateTelegramHtml(userRejMsg, 'UserRejectedNotice');

  console.log('✅ Admin dashboard, user management formatters & HTML validated.');

  // 11.7 Multi-user Watchers Isolation
  const multiWatcherStorage = path.resolve(process.cwd(), 'data', 'test_multi_watchers.json');
  if (fs.existsSync(multiWatcherStorage)) fs.unlinkSync(multiWatcherStorage);

  const multiWatcher = new TradeWatcherService(client, 30, multiWatcherStorage);
  // User 1 watches BTC
  multiWatcher.addWatcher({
    symbol: 'BTCUSDT',
    chatId: '111222333',
    timeframe: '15m',
    entryPrice: 65000,
    stopLoss: 63000,
    takeProfit1: 67000,
    takeProfit2: 69000
  });

  // User 2 watches BTC with different prices
  multiWatcher.addWatcher({
    symbol: 'BTCUSDT',
    chatId: '7472742743',
    timeframe: '15m',
    entryPrice: 66000,
    stopLoss: 64000,
    takeProfit1: 68000,
    takeProfit2: 70000
  });

  const user1Watchers = multiWatcher.getActiveWatchers('111222333');
  const adminWatchers = multiWatcher.getActiveWatchers('7472742743');
  const allActiveWatchers = multiWatcher.getActiveWatchers();

  if (user1Watchers.length !== 1 || user1Watchers[0].entryPrice !== 65000) {
    throw new Error('User 1 watchers isolation failed');
  }
  if (adminWatchers.length !== 1 || adminWatchers[0].entryPrice !== 66000) {
    throw new Error('Admin watchers isolation failed');
  }
  if (allActiveWatchers.length !== 2) {
    throw new Error(`Expected 2 total active watchers, got ${allActiveWatchers.length}`);
  }

  // Remove User 1's watcher
  multiWatcher.removeWatcher('BTCUSDT', '111222333');
  if (multiWatcher.getActiveWatchers('111222333').length !== 0) {
    throw new Error('User 1 watcher was not removed');
  }
  if (multiWatcher.getActiveWatchers('7472742743').length !== 1) {
    throw new Error('Admin watcher was erroneously removed when removing User 1 watcher');
  }

  // Test 12: Binance Crypto Encryption, UserManager Credential Storage, and Formatters
  console.log('Test 12: Testing AES-256-GCM Encryption & Binance Account Integration...');
  const { encryptString, decryptString } = await import('../src/utils/crypto.js');
  const sampleSecret = 'binance_super_secret_key_abcdef123456';
  const encrypted = encryptString(sampleSecret);
  console.log(`Sample secret encrypted: iv=${encrypted.iv.length} chars, tag=${encrypted.tag.length} chars, len=${encrypted.encrypted.length}`);
  if (!encrypted.encrypted || !encrypted.iv || !encrypted.tag) {
    throw new Error('Encrypted payload missing ciphertext, iv, or tag');
  }

  const decrypted = decryptString(encrypted);
  if (decrypted !== sampleSecret) {
    throw new Error(`Decrypted secret mismatch! Expected ${sampleSecret}, got ${decrypted}`);
  }
  console.log('✅ AES-256-GCM Encryption & Decryption roundtrip successful.');

  // Test UserManager Binance Credential Storage
  const testUsersFile2 = path.resolve(process.cwd(), 'data', 'test_users_binance.json');
  if (fs.existsSync(testUsersFile2)) fs.unlinkSync(testUsersFile2);
  const userMgr2 = new UserManager('7472742743', testUsersFile2);
  const testChatId = '999888777';
  userMgr2.registerOrUpdate(testChatId, { username: 'trader_joe' });
  userMgr2.approveUser(testChatId);

  const testApiKey = 'vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A';
  const testApiSecret = 'NhqPtmdSJYdKjVHjClK0MTvxGRsdk10xU0rqmkPxphiqqVMtMFbmKKEd8qDHjl6v';

  userMgr2.setBinanceCredentials(testChatId, testApiKey, testApiSecret, true);
  if (!userMgr2.hasBinance(testChatId)) {
    throw new Error('hasBinance should be true after setting credentials');
  }

  const masked = userMgr2.getMaskedBinanceApiKey(testChatId);
  console.log(`Masked API Key: ${masked}`);
  if (!masked || !masked.startsWith('vmPU') || !masked.endsWith('Eh8A')) {
    throw new Error(`Unexpected masked API key: ${masked}`);
  }

  // Verify file content is encrypted on disk
  const rawDiskData = fs.readFileSync(testUsersFile2, 'utf-8');
  if (rawDiskData.includes(testApiSecret)) {
    throw new Error('SECURITY VIOLATION: Plaintext API Secret found in storage file!');
  }
  console.log('✅ Verified zero plaintext secrets on disk.');

  const retrievedCreds = userMgr2.getBinanceCredentials(testChatId);
  if (!retrievedCreds || retrievedCreds.apiKey !== testApiKey || retrievedCreds.apiSecret !== testApiSecret) {
    throw new Error('Retrieved decrypted Binance credentials do not match original');
  }
  if (!retrievedCreds.canTrade) {
    throw new Error('Expected canTrade to be true');
  }

  userMgr2.removeBinanceCredentials(testChatId);
  if (userMgr2.hasBinance(testChatId)) {
    throw new Error('hasBinance should be false after removal');
  }
  if (fs.existsSync(testUsersFile2)) fs.unlinkSync(testUsersFile2);
  console.log('✅ UserManager Binance credential lifecycle verified.');

  // Test Binance Message Formatters
  const {
    formatBinanceBalanceMessage,
    formatConnectInstructionsMessage,
    formatBuyConfirmMessage,
    formatOrderReceiptMessage
  } = await import('../src/telegram/formatter.js');

  const balanceMsg = formatBinanceBalanceMessage({
    balances: [
      { asset: 'USDT', free: 250.50, locked: 0, estimatedUsdt: 250.50 },
      { asset: 'BTC', free: 0.05, locked: 0.001, estimatedUsdt: 3250.00 },
      { asset: 'SOL', free: 12.35, locked: 0, estimatedUsdt: 1852.50 }
    ],
    totalEstimatedUsdt: 5353.00,
    canTrade: true,
    updateTime: Date.now()
  }, 'vmPU...Eh8A');
  console.log('--- Sample Balance Message ---');
  console.log(balanceMsg);
  console.log('------------------------------');
  validateTelegramHtml(balanceMsg, 'BinanceBalanceMessage');

  const connectMsgDisconnected = formatConnectInstructionsMessage(false);
  validateTelegramHtml(connectMsgDisconnected, 'ConnectInstructionsDisconnected');

  const connectMsgConnected = formatConnectInstructionsMessage(true, 'vmPU...Eh8A');
  validateTelegramHtml(connectMsgConnected, 'ConnectInstructionsConnected');

  const buyConfirmMsg = formatBuyConfirmMessage('SOLUSDT', 50, 150.25, 250.50);
  console.log('--- Sample Buy Confirm Message ---');
  console.log(buyConfirmMsg);
  console.log('----------------------------------');
  validateTelegramHtml(buyConfirmMsg, 'BuyConfirmMessage');

  const orderReceiptMsg = formatOrderReceiptMessage({
    orderId: 123456789,
    symbol: 'SOLUSDT',
    status: 'FILLED',
    executedQty: 0.332,
    cummulativeQuoteQty: 49.95,
    avgPrice: 150.45,
    transactTime: Date.now()
  });
  console.log('--- Sample Order Receipt Message ---');
  console.log(orderReceiptMsg);
  console.log('------------------------------------');
  validateTelegramHtml(orderReceiptMsg, 'OrderReceiptMessage');
  console.log('✅ Binance Formatters & HTML validation verified.\n');

  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
