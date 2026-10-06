import fs from 'fs';
import path from 'path';
import { ExchangeClient } from '../exchange/binance.js';
import { logger } from '../utils/logger.js';
import { formatPrice, formatSymbolDisplay } from '../telegram/formatter.js';

export interface WatchedTrade {
  id: string;
  symbol: string;
  chatId: string;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  stopLossPercent: number;
  takeProfit1Percent: number;
  takeProfit2Percent: number;
  createdAt: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  slHit: boolean;
  status: 'ACTIVE' | 'TP1_HIT' | 'COMPLETED' | 'STOPPED' | 'CANCELLED';
  lastCheckedPrice?: number;
  lastCheckedAt?: number;
}

export type WatcherAlertCallback = (chatId: string, message: string) => Promise<boolean>;

export class TradeWatcherService {
  private exchange: ExchangeClient;
  private watchers: Map<string, WatchedTrade> = new Map();
  private checkIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isChecking = false;
  private storagePath: string;
  private alertCallback?: WatcherAlertCallback;

  constructor(
    exchange: ExchangeClient,
    checkIntervalSeconds: number = 30,
    storagePath: string = path.resolve(process.cwd(), 'data', 'watchers.json')
  ) {
    this.exchange = exchange;
    this.checkIntervalMs = checkIntervalSeconds * 1000;
    this.storagePath = storagePath;
    this.loadFromDisk();
  }

  /**
   * Set callback for sending Telegram alerts
   */
  public setAlertCallback(callback: WatcherAlertCallback): void {
    this.alertCallback = callback;
  }

  /**
   * Start the periodic price checker loop
   */
  public start(): void {
    if (this.timer) return;

    logger.info(`Starting Trade Watcher service (polling interval: ${this.checkIntervalMs / 1000}s)...`);
    this.timer = setInterval(() => {
      this.checkWatchers().catch(err => {
        logger.error(`Trade Watcher cycle error: ${(err as Error).message}`);
      });
    }, this.checkIntervalMs);

    // Run first check after a brief startup delay
    setTimeout(() => {
      this.checkWatchers().catch(() => {});
    }, 3000);
  }

  /**
   * Stop the watcher loop
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Trade Watcher service stopped');
    }
  }

  /**
   * Add or update an active trade watcher
   */
  public addWatcher(params: {
    symbol: string;
    chatId: string;
    timeframe: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number;
    stopLossPercent?: number;
    takeProfit1Percent?: number;
    takeProfit2Percent?: number;
  }): WatchedTrade {
    const symbol = params.symbol.toUpperCase();
    const id = `${symbol}_${params.timeframe}`;

    const slPct =
      params.stopLossPercent ??
      Math.abs((params.entryPrice - params.stopLoss) / params.entryPrice) * 100;
    const tp1Pct =
      params.takeProfit1Percent ??
      Math.abs((params.takeProfit1 - params.entryPrice) / params.entryPrice) * 100;
    const tp2Pct =
      params.takeProfit2Percent ??
      Math.abs((params.takeProfit2 - params.entryPrice) / params.entryPrice) * 100;

    const trade: WatchedTrade = {
      id,
      symbol,
      chatId: params.chatId,
      timeframe: params.timeframe,
      entryPrice: params.entryPrice,
      stopLoss: params.stopLoss,
      takeProfit1: params.takeProfit1,
      takeProfit2: params.takeProfit2,
      stopLossPercent: slPct,
      takeProfit1Percent: tp1Pct,
      takeProfit2Percent: tp2Pct,
      createdAt: Date.now(),
      tp1Hit: false,
      tp2Hit: false,
      slHit: false,
      status: 'ACTIVE',
      lastCheckedPrice: params.entryPrice,
      lastCheckedAt: Date.now()
    };

    const key = `${symbol}_${params.chatId}`;
    this.watchers.set(key, trade);
    this.saveToDisk();
    logger.info(`Trade watcher registered for ${symbol} by user ${params.chatId} (Entry: ${trade.entryPrice}, SL: ${trade.stopLoss}, TP1: ${trade.takeProfit1})`);
    return trade;
  }

  /**
   * Cancel / remove a trade watcher
   */
  public removeWatcher(symbol: string, chatId?: string): boolean {
    const cleanSym = symbol.toUpperCase();
    if (chatId) {
      const key = `${cleanSym}_${chatId}`;
      const existing = this.watchers.get(key);
      if (!existing) return false;

      this.watchers.delete(key);
      this.saveToDisk();
      logger.info(`Trade watcher removed for ${cleanSym} (User: ${chatId})`);
      return true;
    }

    // If no chatId provided, remove all matching symbols
    let removedAny = false;
    for (const [k, trade] of this.watchers.entries()) {
      if (trade.symbol === cleanSym) {
        this.watchers.delete(k);
        removedAny = true;
      }
    }

    if (removedAny) {
      this.saveToDisk();
      logger.info(`All trade watchers removed for ${cleanSym}`);
    }
    return removedAny;
  }

  /**
   * Get active watchers (optionally filtered by chatId)
   */
  public getActiveWatchers(chatId?: string): WatchedTrade[] {
    return Array.from(this.watchers.values()).filter(
      w => (w.status === 'ACTIVE' || w.status === 'TP1_HIT') && (!chatId || w.chatId === chatId)
    );
  }

  /**
   * Get single watcher
   */
  public getWatcher(symbol: string, chatId?: string): WatchedTrade | undefined {
    const cleanSym = symbol.toUpperCase();
    if (chatId) {
      return this.watchers.get(`${cleanSym}_${chatId}`);
    }
    return Array.from(this.watchers.values()).find(w => w.symbol === cleanSym);
  }

  /**
   * Main checking loop: fetches live prices and evaluates TP/SL triggers
   */
  public async checkWatchers(): Promise<void> {
    if (this.isChecking) return;
    const active = this.getActiveWatchers();
    if (active.length === 0) return;

    this.isChecking = true;
    try {
      const symbols = Array.from(new Set(active.map(w => w.symbol)));
      const prices = await this.exchange.getPrices(symbols);

      for (const trade of active) {
        const currentPrice = prices.get(trade.symbol);
        if (!currentPrice || currentPrice <= 0) continue;

        trade.lastCheckedPrice = currentPrice;
        trade.lastCheckedAt = Date.now();

        await this.evaluateTradeLevels(trade, currentPrice);
      }

      this.saveToDisk();
    } catch (err) {
      logger.error(`Error during trade watcher check: ${(err as Error).message}`);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Evaluate a single trade against current price
   */
  private async evaluateTradeLevels(trade: WatchedTrade, currentPrice: number): Promise<void> {
    const pairDisplay = formatSymbolDisplay(trade.symbol);
    const entry = trade.entryPrice;

    // 1. Check Stop Loss trigger (Price drops to or below Stop Loss)
    if (currentPrice <= trade.stopLoss) {
      trade.status = 'STOPPED';
      trade.slHit = true;
      const actualLossPct = ((entry - currentPrice) / entry * 100).toFixed(2);

      logger.warn(`STOP LOSS HIT for ${trade.symbol}: Current=${currentPrice}, SL=${trade.stopLoss}`);

      const message = `🛑 <b>STOP LOSS TERSENTUH!</b>

Pair: <b>${pairDisplay}</b>
Timeframe: <b>${trade.timeframe}</b>

💰 Harga Entry: <b>${formatPrice(trade.entryPrice)}</b>
🛑 Level SL: <b>${formatPrice(trade.stopLoss)}</b> (-${trade.stopLossPercent.toFixed(2)}%)
📉 Harga Saat Ini: <b>${formatPrice(currentPrice)}</b> (-${actualLossPct}%)

⚠️ <b>Tindakan:</b>
Disiplin cut loss sesuai rencana trading untuk melindungi modal Anda dari penurunan lebih lanjut.

<i>Status pemantauan untuk ${pairDisplay} telah dinonaktifkan.</i>`;

      if (this.alertCallback) {
        await this.alertCallback(trade.chatId, message);
      }
      return;
    }

    // 2. Check Take Profit 2 trigger (Max target reached)
    if (currentPrice >= trade.takeProfit2) {
      trade.status = 'COMPLETED';
      trade.tp2Hit = true;
      const actualProfitPct = ((currentPrice - entry) / entry * 100).toFixed(2);

      logger.info(`TAKE PROFIT 2 HIT for ${trade.symbol}: Current=${currentPrice}, TP2=${trade.takeProfit2}`);

      const message = `🚀 <b>MAX TARGET TERCAPAI: TP2 HIT!</b> 🎯🎯

Pair: <b>${pairDisplay}</b>
Timeframe: <b>${trade.timeframe}</b>

💰 Harga Entry: <b>${formatPrice(trade.entryPrice)}</b>
🎯 Target TP2: <b>${formatPrice(trade.takeProfit2)}</b> (+${trade.takeProfit2Percent.toFixed(2)}%)
📈 Harga Saat Ini: <b>${formatPrice(currentPrice)}</b> (+${actualProfitPct}%)
⚖️ Risk / Reward: <b>1 : 2.5</b>

🎉 <b>Tindakan:</b>
Target profit maksimal telah tercapai sempurna! Tutup sisa posisi dan amankan seluruh keuntungan Anda.

<i>Status pemantauan untuk ${pairDisplay} selesai.</i>`;

      if (this.alertCallback) {
        await this.alertCallback(trade.chatId, message);
      }
      return;
    }

    // 3. Check Take Profit 1 trigger (Partial TP reached, move SL to BEP)
    if (!trade.tp1Hit && currentPrice >= trade.takeProfit1) {
      trade.status = 'TP1_HIT';
      trade.tp1Hit = true;
      const actualProfitPct = ((currentPrice - entry) / entry * 100).toFixed(2);

      logger.info(`TAKE PROFIT 1 HIT for ${trade.symbol}: Current=${currentPrice}, TP1=${trade.takeProfit1}`);

      const message = `🎯 <b>TARGET PERTAMA TERCAPAI: TP1 HIT!</b> 🟢

Pair: <b>${pairDisplay}</b>
Timeframe: <b>${trade.timeframe}</b>

💰 Harga Entry: <b>${formatPrice(trade.entryPrice)}</b>
🎯 Target TP1: <b>${formatPrice(trade.takeProfit1)}</b> (+${trade.takeProfit1Percent.toFixed(2)}%)
📈 Harga Saat Ini: <b>${formatPrice(currentPrice)}</b> (+${actualProfitPct}%)
🎯 Target Berikutnya (TP2): <b>${formatPrice(trade.takeProfit2)}</b> (+${trade.takeProfit2Percent.toFixed(2)}%)

💡 <b>Rekomendasi Manajemen Posisi:</b>
1. Amankan 50% profit Anda sekarang.
2. Geser Stop Loss ke titik impas (BEP): <b>${formatPrice(trade.entryPrice)}</b> agar posisi sekarang 100% Risk-Free!

🤖 <i>Bot otomatis terus memantau menuju target TP2...</i>`;

      if (this.alertCallback) {
        await this.alertCallback(trade.chatId, message);
      }
    }
  }

  /**
   * Save active watchers to disk (JSON)
   */
  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = Array.from(this.watchers.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`Failed to save trade watchers to disk: ${(err as Error).message}`);
    }
  }

  /**
   * Load active watchers from disk on startup
   */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storagePath)) return;

      const raw = fs.readFileSync(this.storagePath, 'utf-8');
      const data: WatchedTrade[] = JSON.parse(raw);
      const now = Date.now();
      const maxAgeMs = 48 * 60 * 60 * 1000; // 48 hours

      for (const item of data) {
        // Discard old completed or stopped trades
        const isOldCompleted = (item.status === 'COMPLETED' || item.status === 'STOPPED') && (now - item.createdAt > maxAgeMs);
        if (!isOldCompleted) {
          const key = item.chatId ? `${item.symbol}_${item.chatId}` : item.symbol;
          this.watchers.set(key, item);
        }
      }

      const activeCount = this.getActiveWatchers().length;
      if (activeCount > 0) {
        logger.info(`Restored ${activeCount} active trade watcher(s) from disk.`);
      }
    } catch (err) {
      logger.error(`Failed to load trade watchers from disk: ${(err as Error).message}`);
    }
  }
}
