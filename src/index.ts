import { loadConfig } from './config.js';
import { BinanceClient } from './exchange/binance.js';
import { MarketScanner } from './scanner/marketScanner.js';
import { TelegramBotService } from './telegram/bot.js';
import { TradeWatcherService } from './watcher/tradeWatcher.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info('Starting Spot Signal Bot...');

  // 1. Load and validate configuration
  const config = loadConfig();
  logger.info(`Configuration loaded: ${config.trading.symbols.length} symbols, timeframe: ${config.trading.timeframe}`);

  // 2. Initialize Exchange Client
  const exchange = new BinanceClient(config.exchange.baseUrl, config.exchange.fallbackBaseUrl);
  
  // Test connection to exchange
  logger.info('Checking exchange connectivity...');
  const isExchangeConnected = await exchange.ping();
  if (isExchangeConnected) {
    logger.info('Connected to Binance public market data OK');
  } else {
    logger.warn('Initial exchange ping failed. Bot will continue and retry on klines requests.');
  }

  // 3. Initialize Telegram Bot Service & Trade Watcher
  const botService = new TelegramBotService(config);
  const watcherService = new TradeWatcherService(exchange, 30);
  const userStats = botService.getUserManager().getStats();
  logger.info(`Admin Chat ID: ${config.telegram.adminChatId}`);
  logger.info(`User database: ${userStats.total} total (${userStats.approved} approved, ${userStats.pending} pending)`);

  // Link TradeWatcher alerts to Telegram Bot
  watcherService.setAlertCallback(async (chatId, message) => {
    return botService.sendAlert(message, chatId);
  });
  botService.setWatcherService(watcherService);

  // 4. Initialize Market Scanner
  const scanner = new MarketScanner(config, exchange, botService);

  // 5. Register Telegram Bot Handlers
  botService.registerHandlers({
    onScanAll: async (tf?: string) => scanner.scanAll(tf),
    onScanSymbol: async (symbol: string, tf?: string) => scanner.scanSymbol(symbol, tf),
    onScanScreener: async (limit?: number, tf?: string) => scanner.scanScreener(limit, tf),
    onScanScalping: async (limit?: number, tf?: string) => scanner.scanScalping(limit, tf),
    onScanDaily: async (limit?: number, tf?: string) => scanner.scanDailyTrading(limit, tf),
    getStatusInfo: () => scanner.getStatusInfo()
  });

  // 6. Launch Telegram Bot
  try {
    await botService.launch();
    logger.info('Telegram bot started successfully');
  } catch (err) {
    logger.error(`Failed to start Telegram bot: ${(err as Error).message}`);
    process.exit(1);
  }

  // 7. Start Market Scanner & Trade Watcher loop
  scanner.start();
  watcherService.start();

  // 8. Graceful Shutdown Handlers
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    watcherService.stop();
    scanner.stop();
    botService.stop(signal);
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  logger.error(`Fatal error in main application: ${(err as Error).message}`);
  process.exit(1);
});
