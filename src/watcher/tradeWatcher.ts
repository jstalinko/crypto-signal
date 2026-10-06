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

export interface WatcherHistoryRecord {
  id: string;
  symbol: string;
  chatId: string;
  timeframe: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  pnlPercent: number;
  result: 'WIN' | 'LOSS' | 'BEP';
  status: 'TP2_HIT' | 'TP1_HIT_BEP' | 'SL_HIT' | 'CLOSED_MANUAL';
  entryTime: number;
  closedAt: number;
  durationMs: number;
}

export interface WatcherPnlSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  bep: number;
  winRate: number;
  totalRealizedPnlPercent: number;
  averageWinPercent: number;
  averageLossPercent: number;
  profitFactor: number;
  bestTrade?: WatcherHistoryRecord;
  worstTrade?: WatcherHistoryRecord;
  recentTrades: WatcherHistoryRecord[];
  estimatedUsdtPnl: number;
  activePositionsCount: number;
  unrealizedFloatingPnlPercent: number;
}

export type WatcherAlertCallback = (chatId: string, message: string) => Promise<boolean>;

export class TradeWatcherService {
  private exchange: ExchangeClient;
  private watchers: Map<string, WatchedTrade> = new Map();
  private history: WatcherHistoryRecord[] = [];
  private checkIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isChecking = false;
  private storagePath: string;
  private historyPath: string;
  private alertCallback?: WatcherAlertCallback;

  constructor(
    exchange: ExchangeClient,
    checkIntervalSeconds: number = 15,
    storagePath: string = path.resolve(process.cwd(), 'data', 'watchers.json'),
    historyPath?: string
  ) {
    this.exchange = exchange;
    this.checkIntervalMs = checkIntervalSeconds * 1000;
    this.storagePath = storagePath;
    this.historyPath =
      historyPath ||
      path.resolve(path.dirname(storagePath), path.basename(storagePath, '.json') + '_history.json');
    this.loadHistoryFromDisk();
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
    }, 1000);
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
  public removeWatcher(symbol: string, chatId?: string, recordHistory: boolean = true): boolean {
    const cleanSym = symbol.toUpperCase();
    if (chatId) {
      const key = `${cleanSym}_${chatId}`;
      const existing = this.watchers.get(key);
      if (!existing) return false;

      // If active and manual cancel, record history
      if (recordHistory && (existing.status === 'ACTIVE' || existing.status === 'TP1_HIT')) {
        const exitPrice = existing.lastCheckedPrice || existing.entryPrice;
        let pnlPct = ((exitPrice - existing.entryPrice) / existing.entryPrice) * 100;
        if (existing.tp1Hit) {
          pnlPct = 0.5 * existing.takeProfit1Percent + 0.5 * pnlPct;
        }
        const resultType = pnlPct >= 0.1 ? 'WIN' : pnlPct <= -0.1 ? 'LOSS' : 'BEP';

        this.addHistoryRecord({
          id: `H_${existing.symbol}_${Date.now()}`,
          symbol: existing.symbol,
          chatId: existing.chatId,
          timeframe: existing.timeframe,
          entryPrice: existing.entryPrice,
          exitPrice,
          stopLoss: existing.stopLoss,
          takeProfit1: existing.takeProfit1,
          takeProfit2: existing.takeProfit2,
          pnlPercent: Number(pnlPct.toFixed(2)),
          result: resultType,
          status: 'CLOSED_MANUAL',
          entryTime: existing.createdAt,
          closedAt: Date.now(),
          durationMs: Date.now() - existing.createdAt
        });
      }

      this.watchers.delete(key);
      this.saveToDisk();
      logger.info(`Trade watcher removed for ${cleanSym} (User: ${chatId})`);
      return true;
    }

    // If no chatId provided, remove all matching symbols
    let removedAny = false;
    for (const [k, trade] of this.watchers.entries()) {
      if (trade.symbol === cleanSym) {
        if (recordHistory && (trade.status === 'ACTIVE' || trade.status === 'TP1_HIT')) {
          const exitPrice = trade.lastCheckedPrice || trade.entryPrice;
          let pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
          if (trade.tp1Hit) {
            pnlPct = 0.5 * trade.takeProfit1Percent + 0.5 * pnlPct;
          }
          const resultType = pnlPct >= 0.1 ? 'WIN' : pnlPct <= -0.1 ? 'LOSS' : 'BEP';

          this.addHistoryRecord({
            id: `H_${trade.symbol}_${Date.now()}`,
            symbol: trade.symbol,
            chatId: trade.chatId,
            timeframe: trade.timeframe,
            entryPrice: trade.entryPrice,
            exitPrice,
            stopLoss: trade.stopLoss,
            takeProfit1: trade.takeProfit1,
            takeProfit2: trade.takeProfit2,
            pnlPercent: Number(pnlPct.toFixed(2)),
            result: resultType,
            status: 'CLOSED_MANUAL',
            entryTime: trade.createdAt,
            closedAt: Date.now(),
            durationMs: Date.now() - trade.createdAt
          });
        }
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
    if (this.isChecking) {
      // If a check is already underway, wait briefly up to 2 seconds for it to finish
      let waited = 0;
      while (this.isChecking && waited < 2000) {
        await new Promise(r => setTimeout(r, 100));
        waited += 100;
      }
      if (this.isChecking) return;
    }

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

    // 1. Check Stop Loss / BEP trigger (Price drops to or below Stop Loss)
    if (currentPrice <= trade.stopLoss) {
      trade.status = 'STOPPED';
      trade.slHit = true;
      const actualLossPct = ((entry - currentPrice) / entry * 100).toFixed(2);
      const isBep = trade.tp1Hit;

      let pnlPct: number;
      let resultType: 'WIN' | 'LOSS' | 'BEP';
      let historyStatus: 'TP1_HIT_BEP' | 'SL_HIT';
      let exitPrice: number;

      if (isBep) {
        // TP1 hit (50% profit taken), remaining 50% stopped at BEP (entryPrice)
        pnlPct = trade.takeProfit1Percent / 2;
        resultType = pnlPct > 0.05 ? 'WIN' : 'BEP';
        historyStatus = 'TP1_HIT_BEP';
        exitPrice = trade.stopLoss;
      } else {
        // Direct stop loss hit
        pnlPct = -Number(actualLossPct);
        resultType = 'LOSS';
        historyStatus = 'SL_HIT';
        exitPrice = currentPrice;
      }

      this.addHistoryRecord({
        id: `H_${trade.symbol}_${Date.now()}`,
        symbol: trade.symbol,
        chatId: trade.chatId,
        timeframe: trade.timeframe,
        entryPrice: trade.entryPrice,
        exitPrice,
        stopLoss: trade.stopLoss,
        takeProfit1: trade.takeProfit1,
        takeProfit2: trade.takeProfit2,
        pnlPercent: Number(pnlPct.toFixed(2)),
        result: resultType,
        status: historyStatus,
        entryTime: trade.createdAt,
        closedAt: Date.now(),
        durationMs: Date.now() - trade.createdAt
      });

      logger.warn(`${isBep ? 'BEP PROTECT' : 'STOP LOSS'} HIT for ${trade.symbol}: Current=${currentPrice}, SL=${trade.stopLoss}`);

      const message = isBep
        ? `🛡 <b>BREAK-EVEN PROTECT (BEP) TERSENTUH!</b> 🛡

Pair: <b>${pairDisplay}</b>
Timeframe: <b>${trade.timeframe}</b>

💰 Harga Entry: <b>${formatPrice(trade.entryPrice)}</b>
🛡 Level BEP: <b>${formatPrice(trade.stopLoss)}</b>
📉 Harga Saat Ini: <b>${formatPrice(currentPrice)}</b>

🎉 <b>Hasil Trade:</b>
Profit 50% telah diamankan saat TP1 (+${(trade.takeProfit1Percent / 2).toFixed(2)}% net), dan sisa posisi keluar di titik impas tanpa risiko kerugian sama sekali!

<i>Status pemantauan untuk ${pairDisplay} telah selesai &amp; dicatat ke histori PnL.</i>`
        : `🛑 <b>STOP LOSS TERSENTUH!</b>

Pair: <b>${pairDisplay}</b>
Timeframe: <b>${trade.timeframe}</b>

💰 Harga Entry: <b>${formatPrice(trade.entryPrice)}</b>
🛑 Level SL: <b>${formatPrice(trade.stopLoss)}</b> (-${trade.stopLossPercent.toFixed(2)}%)
📉 Harga Saat Ini: <b>${formatPrice(currentPrice)}</b> (-${actualLossPct}%)

⚠️ <b>Tindakan:</b>
Disiplin cut loss sesuai rencana trading untuk melindungi modal Anda dari penurunan lebih lanjut.

<i>Status pemantauan untuk ${pairDisplay} dinonaktifkan &amp; dicatat ke histori PnL.</i>`;

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

      // 50% locked at TP1, 50% locked at TP2 (or full at TP2 if TP1 wasn't tracked)
      const pnlPct = trade.tp1Hit
        ? (trade.takeProfit1Percent + trade.takeProfit2Percent) / 2
        : trade.takeProfit2Percent;

      this.addHistoryRecord({
        id: `H_${trade.symbol}_${Date.now()}`,
        symbol: trade.symbol,
        chatId: trade.chatId,
        timeframe: trade.timeframe,
        entryPrice: trade.entryPrice,
        exitPrice: currentPrice,
        stopLoss: trade.stopLoss,
        takeProfit1: trade.takeProfit1,
        takeProfit2: trade.takeProfit2,
        pnlPercent: Number(pnlPct.toFixed(2)),
        result: 'WIN',
        status: 'TP2_HIT',
        entryTime: trade.createdAt,
        closedAt: Date.now(),
        durationMs: Date.now() - trade.createdAt
      });

      logger.info(`TAKE PROFIT 2 HIT for ${trade.symbol}: Current=${currentPrice}, TP2=${trade.takeProfit2}`);

      const message = `🚀 <b>MAX TARGET TERCAPAI: TP2 HIT!</b> 🎯🎯

Pair: <b>${pairDisplay}</b>
Timeframe: <b>${trade.timeframe}</b>

💰 Harga Entry: <b>${formatPrice(trade.entryPrice)}</b>
🎯 Target TP2: <b>${formatPrice(trade.takeProfit2)}</b> (+${trade.takeProfit2Percent.toFixed(2)}%)
📈 Harga Saat Ini: <b>${formatPrice(currentPrice)}</b> (+${actualProfitPct}%)
⚖️ Risk / Reward: <b>1 : 2.5</b>

🎉 <b>Tindakan:</b>
Target profit maksimal telah tercapai sempurna! Tutup sisa posisi dan amankan seluruh keuntungan Anda (+${pnlPct.toFixed(2)}% net).

<i>Status pemantauan untuk ${pairDisplay} selesai &amp; dicatat ke histori PnL.</i>`;

      if (this.alertCallback) {
        await this.alertCallback(trade.chatId, message);
      }
      return;
    }

    // 3. Check Take Profit 1 trigger (Partial TP reached, move SL to BEP)
    if (!trade.tp1Hit && currentPrice >= trade.takeProfit1) {
      trade.status = 'TP1_HIT';
      trade.tp1Hit = true;
      // Auto move SL to BEP (Entry Price) to protect the position!
      trade.stopLoss = Math.max(trade.stopLoss, trade.entryPrice);
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
2. Stop Loss telah digeser otomatis ke titik impas (BEP): <b>${formatPrice(trade.entryPrice)}</b> agar sisa posisi 100% Risk-Free!

🤖 <i>Bot otomatis terus memantau menuju target TP2...</i>`;

      if (this.alertCallback) {
        await this.alertCallback(trade.chatId, message);
      }
    }
  }

  /**
   * Add a record directly to history
   */
  public addHistoryRecord(record: WatcherHistoryRecord): void {
    this.history.push(record);
    this.saveHistoryToDisk();
    logger.info(`Watcher history recorded for ${record.symbol} (${record.result}: ${record.pnlPercent >= 0 ? '+' : ''}${record.pnlPercent}%)`);
  }

  /**
   * Get history records (optionally filtered by chatId)
   */
  public getHistory(chatId?: string): WatcherHistoryRecord[] {
    if (!chatId) return [...this.history];
    return this.history.filter(h => h.chatId === chatId);
  }

  /**
   * Clear history (optionally filtered by chatId)
   */
  public clearHistory(chatId?: string): boolean {
    if (chatId) {
      const initialLen = this.history.length;
      this.history = this.history.filter(h => h.chatId !== chatId);
      const changed = this.history.length !== initialLen;
      if (changed) this.saveHistoryToDisk();
      return changed;
    }
    this.history = [];
    this.saveHistoryToDisk();
    return true;
  }

  /**
   * Generate PnL summary analytics
   */
  public generatePnlSummary(chatId?: string): WatcherPnlSummary {
    const records = this.getHistory(chatId);
    const active = this.getActiveWatchers(chatId);

    const totalTrades = records.length;
    let wins = 0;
    let losses = 0;
    let bep = 0;
    let totalRealizedPnlPercent = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;
    let bestTrade: WatcherHistoryRecord | undefined;
    let worstTrade: WatcherHistoryRecord | undefined;

    for (const r of records) {
      totalRealizedPnlPercent += r.pnlPercent;
      if (r.result === 'WIN') {
        wins++;
        totalWinPnl += r.pnlPercent;
      } else if (r.result === 'LOSS') {
        losses++;
        totalLossPnl += Math.abs(r.pnlPercent);
      } else {
        bep++;
      }

      if (!bestTrade || r.pnlPercent > bestTrade.pnlPercent) {
        bestTrade = r;
      }
      if (!worstTrade || r.pnlPercent < worstTrade.pnlPercent) {
        worstTrade = r;
      }
    }

    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const averageWinPercent = wins > 0 ? totalWinPnl / wins : 0;
    const averageLossPercent = losses > 0 ? -(totalLossPnl / losses) : 0;
    const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : (totalWinPnl > 0 ? 99.99 : 0);

    const recentTrades = [...records]
      .sort((a, b) => b.closedAt - a.closedAt)
      .slice(0, 10);

    let unrealizedFloatingPnlPercent = 0;
    for (const trade of active) {
      const currentPrice = trade.lastCheckedPrice || trade.entryPrice;
      const floatingPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
      unrealizedFloatingPnlPercent += floatingPct;
    }

    const estimatedUsdtPnl = totalRealizedPnlPercent; // standard $100 allocated per setup

    return {
      totalTrades,
      wins,
      losses,
      bep,
      winRate: Number(winRate.toFixed(1)),
      totalRealizedPnlPercent: Number(totalRealizedPnlPercent.toFixed(2)),
      averageWinPercent: Number(averageWinPercent.toFixed(2)),
      averageLossPercent: Number(averageLossPercent.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      bestTrade,
      worstTrade,
      recentTrades,
      estimatedUsdtPnl: Number(estimatedUsdtPnl.toFixed(2)),
      activePositionsCount: active.length,
      unrealizedFloatingPnlPercent: Number(unrealizedFloatingPnlPercent.toFixed(2))
    };
  }

  /**
   * Save history to disk (JSON)
   */
  private saveHistoryToDisk(): void {
    try {
      const dir = path.dirname(this.historyPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`Failed to save trade watcher history to disk: ${(err as Error).message}`);
    }
  }

  /**
   * Load history from disk on startup
   */
  private loadHistoryFromDisk(): void {
    try {
      if (!fs.existsSync(this.historyPath)) return;
      const raw = fs.readFileSync(this.historyPath, 'utf-8');
      const data: WatcherHistoryRecord[] = JSON.parse(raw);
      if (Array.isArray(data)) {
        this.history = data;
        logger.info(`Loaded ${this.history.length} watcher history record(s) from disk.`);
      }
    } catch (err) {
      logger.error(`Failed to load trade watcher history from disk: ${(err as Error).message}`);
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

        // If item in watchers.json was completed/stopped, also ensure it exists in history
        if ((item.status === 'COMPLETED' || item.status === 'STOPPED') && item.chatId) {
          const alreadyRecorded = this.history.some(h => h.chatId === item.chatId && h.symbol === item.symbol && h.entryTime === item.createdAt);
          if (!alreadyRecorded) {
            const isCompleted = item.status === 'COMPLETED';
            const isBep = item.tp1Hit && !isCompleted;
            const pnlPct = isCompleted
              ? (item.takeProfit1Percent + item.takeProfit2Percent) / 2
              : isBep
                ? item.takeProfit1Percent / 2
                : -item.stopLossPercent;

            this.history.push({
              id: `H_${item.symbol}_${item.createdAt}`,
              symbol: item.symbol,
              chatId: item.chatId,
              timeframe: item.timeframe,
              entryPrice: item.entryPrice,
              exitPrice: isCompleted ? item.takeProfit2 : item.stopLoss,
              stopLoss: item.stopLoss,
              takeProfit1: item.takeProfit1,
              takeProfit2: item.takeProfit2,
              pnlPercent: Number(pnlPct.toFixed(2)),
              result: pnlPct > 0.05 ? 'WIN' : pnlPct < -0.05 ? 'LOSS' : 'BEP',
              status: isCompleted ? 'TP2_HIT' : isBep ? 'TP1_HIT_BEP' : 'SL_HIT',
              entryTime: item.createdAt,
              closedAt: item.lastCheckedAt || item.createdAt,
              durationMs: (item.lastCheckedAt || item.createdAt) - item.createdAt
            });
          }
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
