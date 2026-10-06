import { AppConfig } from '../config.js';
import { ExchangeClient } from '../exchange/binance.js';
import { generateSignal, SignalResult, SignalType } from '../strategy/signal.js';
import { TelegramBotService } from '../telegram/bot.js';
import { BotStatusInfo } from '../telegram/formatter.js';
import { logger } from '../utils/logger.js';

export interface SymbolSignalState {
  lastSignal: SignalType;
  lastScore: number;
  lastNotifiedAt: number;
}

export class MarketScanner {
  private config: AppConfig;
  private exchange: ExchangeClient;
  private botService?: TelegramBotService;
  private signalStates: Map<string, SymbolSignalState> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private dailyTimer: NodeJS.Timeout | null = null;
  private isScanning = false;
  private isDailyScanning = false;
  private startTime: number;
  private lastScanTimestamp: number = 0;
  private nextScanTimestamp: number = 0;
  private lastDailyUpdateTimestamp: number = 0;
  private nextDailyUpdateTimestamp: number = 0;

  constructor(config: AppConfig, exchange: ExchangeClient, botService?: TelegramBotService) {
    this.config = config;
    this.exchange = exchange;
    this.botService = botService;
    this.startTime = Date.now();
  }

  public setBotService(botService: TelegramBotService): void {
    this.botService = botService;
  }

  /**
   * Start the periodic scanner loop
   */
  public start(): void {
    const intervalSeconds = this.config.trading.scanIntervalSeconds || 60;
    const intervalMs = intervalSeconds * 1000;

    logger.info(`Starting Market Scanner with interval ${intervalSeconds}s for symbols: ${this.config.trading.symbols.join(', ')}`);

    // Run first scan immediately
    this.runScanCycle().catch(err => {
      logger.error(`Initial scan cycle encountered error: ${(err as Error).message}`);
    });

    this.timer = setInterval(() => {
      this.runScanCycle().catch(err => {
        logger.error(`Periodic scan cycle encountered error: ${(err as Error).message}`);
      });
    }, intervalMs);

    this.nextScanTimestamp = Date.now() + intervalMs;

    // Start periodic daily trading updates if enabled
    if (this.config.dailyTrading?.enabled) {
      const intervalHours = this.config.dailyTrading.intervalHours || 4;
      const dailyIntervalMs = intervalHours * 60 * 60 * 1000;
      logger.info(`Daily Trading Scheduler enabled (every ${intervalHours}h on ${this.config.dailyTrading.timeframe || '1h'}).`);

      // Run initial daily scan after 15s to let exchange connection settle
      setTimeout(() => {
        this.runDailyTradingCycle().catch(err => {
          logger.error(`Initial daily trading scan encountered error: ${(err as Error).message}`);
        });
      }, 15000);

      this.dailyTimer = setInterval(() => {
        this.runDailyTradingCycle().catch(err => {
          logger.error(`Periodic daily trading scan encountered error: ${(err as Error).message}`);
        });
      }, dailyIntervalMs);

      this.nextDailyUpdateTimestamp = Date.now() + dailyIntervalMs;
    }
  }

  /**
   * Stop the scanner loop
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Market Scanner stopped');
    }
    if (this.dailyTimer) {
      clearInterval(this.dailyTimer);
      this.dailyTimer = null;
      logger.info('Daily Trading Scanner stopped');
    }
  }

  /**
   * Run a complete scan cycle across all configured symbols
   */
  public async runScanCycle(): Promise<void> {
    if (this.isScanning) {
      logger.warn('Previous scan cycle is still active. Skipping this interval to prevent overlap.');
      return;
    }

    this.isScanning = true;
    const symbols = this.config.trading.symbols;
    logger.info(`Scanning ${symbols.length} symbol${symbols.length > 1 ? 's' : ''}...`);

    try {
      for (const symbol of symbols) {
        try {
          const result = await this.scanSymbol(symbol);
          logger.info(`${symbol} score=${result.score} signal=${result.signal}`);

          // Check if notification is warranted
          await this.evaluateAndDispatchAlert(result);
        } catch (symbolErr) {
          logger.error(`Failed to scan ${symbol}: ${(symbolErr as Error).message}`);
        }
      }

      this.lastScanTimestamp = Date.now();
      const intervalMs = (this.config.trading.scanIntervalSeconds || 60) * 1000;
      this.nextScanTimestamp = this.lastScanTimestamp + intervalMs;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Helper to normalize coin tickers to standard Binance pair (e.g. sol -> SOLUSDT)
   */
  public static normalizeSymbol(raw: string): string {
    let s = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s.endsWith('USDT') && !s.endsWith('BUSD') && !s.endsWith('USDC')) {
      s += 'USDT';
    }
    return s;
  }

  /**
   * Scan a single symbol and calculate its technical signal
   */
  public async scanSymbol(rawSymbol: string, customTimeframe?: string): Promise<SignalResult> {
    const symbol = MarketScanner.normalizeSymbol(rawSymbol);
    const tf = customTimeframe || this.config.trading.timeframe;

    const candles = await this.exchange.getCandles(
      symbol,
      tf,
      this.config.trading.candleLimit
    );

    return generateSignal(
      symbol,
      candles,
      tf,
      this.config.strategy
    );
  }

  /**
   * Scan all configured symbols on-demand (used by /scan command)
   */
  public async scanAll(customTimeframe?: string): Promise<SignalResult[]> {
    const results: SignalResult[] = [];
    for (const symbol of this.config.trading.symbols) {
      try {
        const res = await this.scanSymbol(symbol, customTimeframe);
        results.push(res);
      } catch (err) {
        logger.error(`On-demand scan failed for ${symbol}: ${(err as Error).message}`);
      }
    }
    return results;
  }

  /**
   * Market Screener: Scans top volume USDT coins from Binance to find entry setups
   */
  public async scanScreener(
    limit: number = 30,
    customTimeframe?: string
  ): Promise<{ results: SignalResult[]; totalScanned: number }> {
    const tf = customTimeframe || this.config.trading.timeframe;
    logger.info(`Running Market Screener for top ${limit} USDT pairs on timeframe ${tf}...`);

    let symbols = await this.exchange.getTopUsdtSymbols(limit);
    if (!symbols || symbols.length === 0) {
      // Fallback to configured symbols if ticker request returns empty
      symbols = this.config.trading.symbols;
    }

    const results: SignalResult[] = [];
    const batchSize = 5;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchPromises = batch.map(async (symbol) => {
        try {
          return await this.scanSymbol(symbol, tf);
        } catch (err) {
          logger.warn(`Screener skipping ${symbol}: ${(err as Error).message}`);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const res of batchResults) {
        if (res) results.push(res);
      }

      // Small pause between batches to respect exchange rate limits smoothly
      if (i + batchSize < symbols.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Sort results by score descending
    results.sort((a, b) => b.score - a.score);

    return {
      results,
      totalScanned: symbols.length
    };
  }

  /**
   * Scalping Scanner: Scans for rapid momentum breakout setups on 15m - 30m timeframes
   */
  public async scanScalping(
    limit: number = 25,
    customTimeframe: string = '15m'
  ): Promise<{ results: SignalResult[]; totalScanned: number }> {
    const tf = customTimeframe === '30m' ? '30m' : '15m';
    logger.info(`Running Scalping Scanner for top ${limit} USDT pairs on timeframe ${tf}...`);

    let symbols = await this.exchange.getTopUsdtSymbols(limit);
    if (!symbols || symbols.length === 0) {
      symbols = this.config.trading.symbols;
    }

    const results: SignalResult[] = [];
    const batchSize = 5;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchPromises = batch.map(async (symbol) => {
        try {
          const res = await this.scanSymbol(symbol, tf);
          // Highlight coins with good scalping momentum (Score >= 55)
          if (res.score >= 55) {
            return res;
          }
          return null;
        } catch {
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const res of batchResults) {
        if (res) results.push(res);
      }

      if (i + batchSize < symbols.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Sort results by score descending
    results.sort((a, b) => b.score - a.score);

    return {
      results,
      totalScanned: symbols.length
    };
  }

  /**
   * Daily Trading Scanner: Scans top liquid Binance USDT pairs (1h timeframe) for high-probability daily trade setups
   */
  public async scanDailyTrading(
    limit: number = 3,
    customTimeframe?: string
  ): Promise<{ results: SignalResult[]; totalScanned: number }> {
    const tf = customTimeframe || this.config.dailyTrading?.timeframe || '1h';
    const minScore = this.config.dailyTrading?.minScore || 70;
    const fetchLimit = 35;

    logger.info(`Running Daily Trading Scanner for top ${fetchLimit} USDT pairs on timeframe ${tf}...`);

    let symbols = await this.exchange.getTopUsdtSymbols(fetchLimit);
    if (!symbols || symbols.length === 0) {
      symbols = this.config.trading.symbols;
    }

    const candidateResults: SignalResult[] = [];
    const batchSize = 5;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchPromises = batch.map(async (symbol) => {
        try {
          const res = await this.scanSymbol(symbol, tf);
          // For daily trading, filter for setups with solid score and realistic risk (SL <= 8.5%)
          if (res.score >= minScore && res.stopLossPercent <= 8.5) {
            return res;
          }
          return null;
        } catch (err) {
          logger.warn(`Daily scanner skipping ${symbol}: ${(err as Error).message}`);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      for (const res of batchResults) {
        if (res) candidateResults.push(res);
      }

      if (i + batchSize < symbols.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Sort: BUY signals first, then by score descending
    candidateResults.sort((a, b) => {
      if (a.signal === 'BUY' && b.signal !== 'BUY') return -1;
      if (a.signal !== 'BUY' && b.signal === 'BUY') return 1;
      return b.score - a.score;
    });

    const topPicks = candidateResults.slice(0, limit);

    return {
      results: topPicks,
      totalScanned: symbols.length
    };
  }

  /**
   * Run automated daily trading cycle and broadcast updates to Telegram
   */
  public async runDailyTradingCycle(): Promise<void> {
    if (this.isDailyScanning) {
      logger.warn('Previous daily trading scan cycle still active. Skipping.');
      return;
    }
    if (!this.botService) return;

    this.isDailyScanning = true;
    try {
      const tf = this.config.dailyTrading?.timeframe || '1h';
      const limit = this.config.dailyTrading?.limit || 3;
      logger.info('Executing scheduled Daily Trading scan...');

      const { results, totalScanned } = await this.scanDailyTrading(limit, tf);
      this.lastDailyUpdateTimestamp = Date.now();
      const intervalMs = (this.config.dailyTrading?.intervalHours || 4) * 60 * 60 * 1000;
      this.nextDailyUpdateTimestamp = this.lastDailyUpdateTimestamp + intervalMs;

      if (results.length > 0) {
        logger.info(`Found ${results.length} daily trading candidate setups. Dispatching update to Telegram.`);
        await this.botService.sendDailyTradingUpdate(results, totalScanned, tf, true);
      } else {
        logger.info('No daily trading setups met threshold (score >= minScore). Skipping automated alert.');
      }
    } catch (err) {
      logger.error(`Error in runDailyTradingCycle: ${(err as Error).message}`);
    } finally {
      this.isDailyScanning = false;
    }
  }

  /**
   * Duplicate signal prevention & state transition evaluation
   */
  private async evaluateAndDispatchAlert(result: SignalResult): Promise<void> {
    if (!this.botService) return;

    const { symbol, signal, score } = result;
    const now = Date.now();
    const cooldownMs = (this.config.telegram.cooldownMinutes || 30) * 60 * 1000;

    const state = this.signalStates.get(symbol);

    if (!state) {
      // First observation for this symbol
      this.signalStates.set(symbol, {
        lastSignal: signal,
        lastScore: score,
        lastNotifiedAt: signal === 'BUY' ? now : 0
      });

      if (signal === 'BUY') {
        logger.info(`New BUY signal detected for ${symbol} (initial detection). Dispatching Telegram alert.`);
        await this.botService.sendBuySignalAlert(result);
      }
      return;
    }

    const previousSignal = state.lastSignal;
    const previousScore = state.lastScore;
    const timeSinceLastNotification = now - state.lastNotifiedAt;

    // Check transition: HOLD/WATCH/SELL -> BUY
    const isNewBuySignal = signal === 'BUY' && previousSignal !== 'BUY';

    // Or BUY continued with significant score change and cooldown elapsed
    const isBuySignificantUpdate =
      signal === 'BUY' &&
      previousSignal === 'BUY' &&
      Math.abs(score - previousScore) >= 10 &&
      timeSinceLastNotification >= cooldownMs;

    if (isNewBuySignal || isBuySignificantUpdate) {
      logger.info(
        `Dispatching Telegram BUY alert for ${symbol} (Reason: ${
          isNewBuySignal ? `Transition from ${previousSignal}` : 'Significant score change after cooldown'
        })`
      );

      const sent = await this.botService.sendBuySignalAlert(result);
      if (sent) {
        state.lastNotifiedAt = now;
      }
    }

    // Always update latest recorded state
    state.lastSignal = signal;
    state.lastScore = score;
    this.signalStates.set(symbol, state);
  }

  /**
   * Generates status information for the /status command
   */
  public getStatusInfo(): BotStatusInfo {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const formatTime = (ts: number): string => {
      if (ts === 0) return 'Pending first scan';
      const d = new Date(ts);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const uptimeMs = Date.now() - this.startTime;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);

    let uptimeStr = '';
    if (hours > 0) {
      uptimeStr = `${hours}h ${minutes}m`;
    } else {
      uptimeStr = `${minutes}m ${seconds}s`;
    }

    const dailyStatus = this.config.dailyTrading?.enabled
      ? `ACTIVE (${this.config.dailyTrading.intervalHours}h interval, ${this.config.dailyTrading.timeframe})`
      : 'DISABLED';

    return {
      status: this.isScanning ? 'SCANNING' : 'ONLINE',
      exchange: 'Binance',
      symbolCount: this.config.trading.symbols.length,
      timeframe: this.config.trading.timeframe,
      lastScanTime: formatTime(this.lastScanTimestamp),
      nextScanTime: formatTime(this.nextScanTimestamp),
      uptime: uptimeStr,
      dailyTradingStatus: dailyStatus,
      nextDailyScanTime: this.config.dailyTrading?.enabled ? formatTime(this.nextDailyUpdateTimestamp) : undefined
    };
  }
}
