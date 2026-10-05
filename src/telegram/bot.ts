import { Telegraf, Markup } from 'telegraf';
import { AppConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  formatBuySignalMessage,
  formatScanSummaryMessage,
  formatSingleAnalysisMessage,
  formatScreenerMessage,
  formatScalpingMessage,
  formatWatcherConfirmationMessage,
  formatWatchersListMessage,
  formatBotStatusMessage,
  formatStartMessage,
  formatHelpMessage,
  formatSymbolDisplay,
  escapeHtml,
  BotStatusInfo
} from './formatter.js';
import { SignalResult } from '../strategy/signal.js';
import { TradeWatcherService } from '../watcher/tradeWatcher.js';

export interface TelegramBotHandlers {
  onScanAll: (timeframe?: string) => Promise<SignalResult[]>;
  onScanSymbol: (symbol: string, timeframe?: string) => Promise<SignalResult>;
  onScanScreener: (limit?: number, timeframe?: string) => Promise<{ results: SignalResult[]; totalScanned: number }>;
  onScanScalping: (limit?: number, timeframe?: string) => Promise<{ results: SignalResult[]; totalScanned: number }>;
  getStatusInfo: () => BotStatusInfo;
}

const RESERVED_COMMANDS = new Set([
  'start',
  'help',
  'status',
  'scan',
  'screener',
  'find',
  'signals',
  'scalp',
  'watchers',
  'active',
  'unwatch',
  'analyze',
  'entry',
  'cek'
]);

export class TelegramBotService {
  private bot: Telegraf;
  private config: AppConfig;
  private handlers?: TelegramBotHandlers;
  private watcherService?: TradeWatcherService;
  private isRunning = false;

  constructor(config: AppConfig) {
    this.config = config;
    this.bot = new Telegraf(config.telegram.token);
  }

  /**
   * Set reference to TradeWatcherService
   */
  public setWatcherService(watcherService: TradeWatcherService): void {
    this.watcherService = watcherService;
  }

  /**
   * Safely reply with HTML formatting. If Telegram returns 400 Bad Request
   * due to unsupported HTML tags or entity errors, fallback to plain text.
   */
  public async replySafe(ctx: any, html: string): Promise<any> {
    try {
      return await ctx.reply(html, { parse_mode: 'HTML' });
    } catch (err) {
      logger.warn(`Failed to send HTML reply: ${(err as Error).message}. Falling back to plain text.`);
      const plainText = html.replace(/<[^>]*>/g, '');
      return await ctx.reply(plainText);
    }
  }

  /**
   * Register command handlers and start bot
   */
  public registerHandlers(handlers: TelegramBotHandlers): void {
    this.handlers = handlers;

    // Security Middleware: Authorize only the configured chatId
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id.toString();
      const authorizedChatId = this.config.telegram.chatId.toString();

      if (!chatId || chatId !== authorizedChatId) {
        logger.warn(`Unauthorized access attempt from Chat ID: ${chatId || 'unknown'}`);
        await ctx.reply('⛔ <b>Unauthorized</b>. This bot is configured for private use.', {
          parse_mode: 'HTML'
        }).catch(() => {});
        return;
      }

      return next();
    });

    const exampleCoins = ['btc', 'eth', 'sol', 'sui', 'near', 'doge', 'pepe', 'xrp'];

    // /start command
    this.bot.command('start', async (ctx) => {
      try {
        const text = formatStartMessage(exampleCoins);
        await this.replySafe(ctx, text);
      } catch (err) {
        logger.error(`Error handling /start: ${(err as Error).message}`);
      }
    });

    // /help command
    this.bot.command('help', async (ctx) => {
      try {
        const text = formatHelpMessage();
        await this.replySafe(ctx, text);
      } catch (err) {
        logger.error(`Error handling /help: ${(err as Error).message}`);
      }
    });

    // /status command
    this.bot.command('status', async (ctx) => {
      try {
        if (!this.handlers) return;
        const statusInfo = this.handlers.getStatusInfo();
        const text = formatBotStatusMessage(statusInfo);
        await this.replySafe(ctx, text);
      } catch (err) {
        logger.error(`Error handling /status: ${(err as Error).message}`);
      }
    });

    // /screener, /find, /signals command: Market Screener across top Binance coins
    const handleScreener = async (ctx: any, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const tf = timeframe || this.config.trading.timeframe;
        await ctx.reply(`⏳ <i>Scanning 30 koin volume tertinggi di Binance (${tf}) untuk mencari peluang entry...</i>`, {
          parse_mode: 'HTML'
        });

        const { results, totalScanned } = await this.handlers.onScanScreener(30, tf);
        const text = formatScreenerMessage(results, totalScanned, tf);
        await this.replySafe(ctx, text);
      } catch (err) {
        logger.error(`Error handling screener: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal melakukan screener market: ${escapeHtml((err as Error).message)}`);
      }
    };

    this.bot.command('screener', async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const tf = parts[1];
      await handleScreener(ctx, tf);
    });

    this.bot.command('find', async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const tf = parts[1];
      await handleScreener(ctx, tf);
    });

    this.bot.command('signals', async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const tf = parts[1];
      await handleScreener(ctx, tf);
    });

    // /scalp command: Fast momentum scalping radar on 15m - 30m
    this.bot.command('scalp', async (ctx) => {
      try {
        if (!this.handlers) return;
        const parts = ctx.message.text.trim().split(/\s+/);
        const tf = parts[1] === '30m' ? '30m' : '15m';

        await ctx.reply(`⚡ <i>Memindai peluang momentum scalping cepat (${tf})...</i>`, {
          parse_mode: 'HTML'
        });

        const { results, totalScanned } = await this.handlers.onScanScalping(25, tf);
        const text = formatScalpingMessage(results, totalScanned, tf);
        await this.replySafe(ctx, text);
      } catch (err) {
        logger.error(`Error handling /scalp: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal scan scalping: ${escapeHtml((err as Error).message)}`);
      }
    });

    // /watchers & /active command: List all active tracked trades
    this.bot.command(['watchers', 'active'], async (ctx) => {
      try {
        if (!this.watcherService) {
          await ctx.reply('ℹ️ Watcher service belum diaktifkan.');
          return;
        }
        const active = this.watcherService.getActiveWatchers();
        const text = formatWatchersListMessage(active);
        await this.replySafe(ctx, text);
      } catch (err) {
        logger.error(`Error handling /watchers: ${(err as Error).message}`);
      }
    });

    // /unwatch command: Stop watching a specific trade
    this.bot.command('unwatch', async (ctx) => {
      try {
        const parts = ctx.message.text.trim().split(/\s+/);
        const coin = parts[1];
        if (!coin) {
          await this.replySafe(
            ctx,
            `⚠️ <b>Format Penggunaan:</b>\n<code>/unwatch &lt;koin&gt;</code>\n\nContoh: <code>/unwatch NEAR</code>`
          );
          return;
        }

        const clean = coin.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const sym = clean.endsWith('USDT') ? clean : `${clean}USDT`;

        if (this.watcherService) {
          const removed = this.watcherService.removeWatcher(sym);
          if (removed) {
            await ctx.reply(`✅ Pemantauan live untuk <b>${formatSymbolDisplay(sym)}</b> telah dibatalkan.`, {
              parse_mode: 'HTML'
            });
          } else {
            await ctx.reply(`ℹ️ <b>${formatSymbolDisplay(sym)}</b> tidak ditemukan di daftar pantauan aktif.`, {
              parse_mode: 'HTML'
            });
          }
        }
      } catch (err) {
        logger.error(`Error handling /unwatch: ${(err as Error).message}`);
      }
    });

    // /scan command (Watchlist scan or /scan all for screener)
    this.bot.command('scan', async (ctx) => {
      try {
        if (!this.handlers) return;
        const parts = ctx.message.text.trim().split(/\s+/);
        const arg = parts[1]?.toLowerCase();

        if (arg === 'all' || arg === 'top' || arg === 'market') {
          const tf = parts[2];
          await handleScreener(ctx, tf);
          return;
        }

        const tf = arg && /^\d+[mhd]$/.test(arg) ? arg : undefined;
        await ctx.reply(`⏳ <i>Scanning watchlist pair (${tf || this.config.trading.timeframe})...</i>`, {
          parse_mode: 'HTML'
        });
        const results = await this.handlers.onScanAll(tf);
        const text = formatScanSummaryMessage(results);
        await this.replySafe(ctx, text);
      } catch (err) {
        logger.error(`Error handling /scan: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal scan market: ${escapeHtml((err as Error).message)}`);
      }
    });

    // Universal single coin analyzer handler (with "Notice Me" inline button!)
    const analyzeCoin = async (ctx: any, symbolInput: string, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const cleanSymbol = symbolInput.trim().toUpperCase();
        const tf = timeframe || this.config.trading.timeframe;

        await ctx.reply(`⏳ <i>Menganalisa ${cleanSymbol} (${tf})...</i>`, { parse_mode: 'HTML' });
        const result = await this.handlers.onScanSymbol(cleanSymbol, tf);
        const text = formatSingleAnalysisMessage(result);

        // Attach "Notice Me" action button
        const inlineKeyboard = Markup.inlineKeyboard([
          [Markup.button.callback('🔔 Notice Me (Pantau Otomatis)', `notice:${result.symbol}:${result.timeframe}`)]
        ]);

        try {
          await ctx.reply(text, {
            parse_mode: 'HTML',
            ...inlineKeyboard
          });
        } catch {
          await this.replySafe(ctx, text);
        }
      } catch (err) {
        logger.error(`Error analyzing ${symbolInput}: ${(err as Error).message}`);
        await ctx.reply(`❌ Analisa gagal untuk <b>${escapeHtml(symbolInput.toUpperCase())}</b>: ${escapeHtml((err as Error).message)}`, {
          parse_mode: 'HTML'
        }).catch(async () => {
          await ctx.reply(`❌ Analisa gagal untuk ${symbolInput.toUpperCase()}: ${(err as Error).message}`);
        });
      }
    };

    // /analyze, /entry, /cek command
    const handleAnalyzeCommand = async (ctx: any) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const coin = parts[1];
      const tf = parts[2];

      if (!coin) {
        await this.replySafe(
          ctx,
          `⚠️ <b>Format Penggunaan:</b>\n<code>/analyze &lt;koin&gt; [timeframe]</code>\n\n<b>Contoh:</b>\n• <code>/analyze SOL</code>\n• <code>/analyze SUI 1h</code>\n• <code>/analyze DOGE 15m</code>`
        );
        return;
      }

      await analyzeCoin(ctx, coin, tf);
    };

    this.bot.command('analyze', handleAnalyzeCommand);
    this.bot.command('entry', handleAnalyzeCommand);
    this.bot.command('cek', handleAnalyzeCommand);

    // Callback Query Handler: "Notice Me" clicked!
    this.bot.action(/^notice:([A-Z0-9]+):([a-z0-9]+)$/i, async (ctx) => {
      try {
        const symbol = ctx.match[1].toUpperCase();
        const tf = ctx.match[2];
        const chatId = ctx.chat?.id.toString();

        if (!chatId || !this.watcherService) {
          await ctx.answerCbQuery('❌ Watcher service belum aktif.');
          return;
        }

        await ctx.answerCbQuery(`🔔 Notice Me aktif untuk ${symbol}!`);

        if (!this.handlers) return;
        const result = await this.handlers.onScanSymbol(symbol, tf);

        const trade = this.watcherService.addWatcher({
          symbol: result.symbol,
          chatId,
          timeframe: result.timeframe,
          entryPrice: result.entryPrice,
          stopLoss: result.stopLoss,
          takeProfit1: result.takeProfit1,
          takeProfit2: result.takeProfit2,
          stopLossPercent: result.stopLossPercent,
          takeProfit1Percent: result.takeProfit1Percent,
          takeProfit2Percent: result.takeProfit2Percent
        });

        const confirmMsg = formatWatcherConfirmationMessage(trade);
        await ctx.reply(confirmMsg, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Hentikan Pantauan', `unwatch:${symbol}`)]
          ])
        });
      } catch (err) {
        logger.error(`Error in Notice Me action: ${(err as Error).message}`);
        await ctx.answerCbQuery('❌ Gagal mengaktifkan Notice Me.').catch(() => {});
      }
    });

    // Callback Query Handler: Cancel watcher button clicked!
    this.bot.action(/^unwatch:([A-Z0-9]+)$/i, async (ctx) => {
      try {
        const symbol = ctx.match[1].toUpperCase();
        if (this.watcherService) {
          this.watcherService.removeWatcher(symbol);
        }
        await ctx.answerCbQuery(`✅ Pantauan ${symbol} dihentikan.`);
        await ctx.reply(`✅ Pemantauan otomatis untuk <b>${formatSymbolDisplay(symbol)}</b> telah dihentikan.`, {
          parse_mode: 'HTML'
        });
      } catch (err) {
        logger.error(`Error in unwatch action: ${(err as Error).message}`);
      }
    });

    // Universal dynamic slash command handler for ANY coin: e.g. /btc, /eth, /sol, /doge, /pepe, /sui
    this.bot.on('text', async (ctx, next) => {
      const text = ctx.message.text.trim();
      if (!text.startsWith('/')) {
        return next();
      }

      const parts = text.slice(1).split(/\s+/);
      const rawCmd = parts[0].toLowerCase().split('@')[0]; // handle @bot_username
      const tf = parts[1];

      // Handle /unwatch_<coin> shortcut
      const unwatchMatch = rawCmd.match(/^unwatch_([a-z0-9]+)$/);
      if (unwatchMatch) {
        const coin = unwatchMatch[1].toUpperCase();
        const sym = coin.endsWith('USDT') ? coin : `${coin}USDT`;
        if (this.watcherService) {
          this.watcherService.removeWatcher(sym);
          await ctx.reply(`✅ Pemantauan live untuk <b>${formatSymbolDisplay(sym)}</b> telah dihentikan.`, {
            parse_mode: 'HTML'
          });
          return;
        }
      }

      // If it's a registered command, let Telegraf command handlers process it
      if (RESERVED_COMMANDS.has(rawCmd)) {
        return next();
      }

      // If it looks like a crypto ticker (e.g. sol, doge, pepe, near, sui, btc, eth)
      if (/^[a-z0-9]{2,12}$/i.test(rawCmd)) {
        await analyzeCoin(ctx, rawCmd, tf);
        return;
      }

      return next();
    });

    // Catch-all error handler for Telegraf
    this.bot.catch((err, ctx) => {
      logger.error(`Telegraf error for update ${ctx.update.update_id}: ${(err as Error).message}`);
    });
  }

  /**
   * Launch Telegram Bot long-polling
   */
  public async launch(): Promise<void> {
    try {
      await this.bot.launch();
      this.isRunning = true;
      logger.info('Telegram bot polling started');
    } catch (err) {
      logger.error(`Failed to launch Telegram bot: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Send notification / alert message to configured Telegram Chat ID
   */
  public async sendAlert(htmlMessage: string, targetChatId?: string): Promise<boolean> {
    const destChatId = targetChatId || this.config.telegram.chatId;
    try {
      await this.bot.telegram.sendMessage(destChatId, htmlMessage, {
        parse_mode: 'HTML'
      });
      return true;
    } catch (err) {
      logger.warn(`Failed to send Telegram HTML alert: ${(err as Error).message}. Retrying with plain text.`);
      try {
        const plainText = htmlMessage.replace(/<[^>]*>/g, '');
        await this.bot.telegram.sendMessage(destChatId, plainText);
        return true;
      } catch (fallbackErr) {
        logger.error(`Failed to send Telegram plain text alert: ${(fallbackErr as Error).message}`);
        return false;
      }
    }
  }

  /**
   * Send Buy Signal notification (with Notice Me button!)
   */
  public async sendBuySignalAlert(result: SignalResult): Promise<boolean> {
    const message = formatBuySignalMessage(result);
    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔔 Notice Me (Pantau Otomatis)', `notice:${result.symbol}:${result.timeframe}`)]
    ]);

    try {
      await this.bot.telegram.sendMessage(this.config.telegram.chatId, message, {
        parse_mode: 'HTML',
        ...inlineKeyboard
      });
      return true;
    } catch {
      return this.sendAlert(message);
    }
  }

  /**
   * Stop bot gracefully
   */
  public stop(reason: string = 'SIGINT'): void {
    if (this.isRunning) {
      this.bot.stop(reason);
      this.isRunning = false;
      logger.info(`Telegram bot stopped (${reason})`);
    }
  }
}
