import { Telegraf, Markup } from 'telegraf';
import { AppConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  formatBuySignalMessage,
  formatScanSummaryMessage,
  formatSingleAnalysisMessage,
  formatScreenerMessage,
  formatScalpingMessage,
  formatDailyTradingMessage,
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
  onScanDaily: (limit?: number, timeframe?: string) => Promise<{ results: SignalResult[]; totalScanned: number }>;
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
  'daily',
  'suggestion',
  'menu',
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
   * Main persistent reply keyboard with core shortcuts
   */
  public getMainReplyKeyboard() {
    return Markup.keyboard([
      ['🔍 Screener (/find)', '⚡ Scalp Radar (/scalp)'],
      ['🎯 Daily Entry (/daily)', '📋 Watchers (/watchers)'],
      ['📊 Scan Watchlist (/scan)', 'ℹ️ Help & Status (/help)']
    ]).resize();
  }

  /**
   * Main interactive inline keyboard for /menu
   */
  public getMainInlineKeyboard() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🔍 Screener (/find)', 'menu:find'),
        Markup.button.callback('⚡ Scalp Radar (/scalp)', 'menu:scalp')
      ],
      [
        Markup.button.callback('🎯 Daily Entry (/daily)', 'menu:daily'),
        Markup.button.callback('📋 Watchers (/watchers)', 'menu:watchers')
      ],
      [
        Markup.button.callback('📊 Scan Watchlist (/scan)', 'menu:scan'),
        Markup.button.callback('⚙️ Bot Status (/status)', 'menu:status')
      ],
      [
        Markup.button.callback('📖 Panduan & Help (/help)', 'menu:help')
      ]
    ]);
  }

  /**
   * Safely reply with HTML formatting. If Telegram returns 400 Bad Request
   * due to unsupported HTML tags or entity errors, fallback to plain text.
   */
  public async replySafe(ctx: any, html: string, extra?: any): Promise<any> {
    try {
      return await ctx.reply(html, { parse_mode: 'HTML', ...(extra || {}) });
    } catch (err) {
      logger.warn(`Failed to send HTML reply: ${(err as Error).message}. Falling back to plain text.`);
      const plainText = html.replace(/<[^>]*>/g, '');
      return await ctx.reply(plainText, extra);
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

    // 1. Helper handlers
    const handleStart = async (ctx: any) => {
      try {
        const text = formatStartMessage(exampleCoins);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard());
      } catch (err) {
        logger.error(`Error handling /start: ${(err as Error).message}`);
      }
    };

    const handleHelp = async (ctx: any) => {
      try {
        const text = formatHelpMessage();
        await this.replySafe(ctx, text, this.getMainReplyKeyboard());
      } catch (err) {
        logger.error(`Error handling /help: ${(err as Error).message}`);
      }
    };

    const handleStatus = async (ctx: any) => {
      try {
        if (!this.handlers) return;
        const statusInfo = this.handlers.getStatusInfo();
        const text = formatBotStatusMessage(statusInfo);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard());
      } catch (err) {
        logger.error(`Error handling /status: ${(err as Error).message}`);
      }
    };

    const handleMenu = async (ctx: any) => {
      try {
        const menuText = `📱 <b>CHAEWON CRYPTO SIGNAL — MAIN MENU</b>\n\n` +
          `Pilih perintah melalui tombol menu interaktif berikut atau gunakan tombol keyboard di bawah layar:\n\n` +
          `• 🔍 <b>Screener (/find)</b>: Scan 30 koin aktif di Binance\n` +
          `• ⚡ <b>Scalp Radar (/scalp)</b>: Momentum cepat timeframe 15m/30m\n` +
          `• 🎯 <b>Daily Entry (/daily)</b>: Rekomendasi entry trading harian (1h)\n` +
          `• 📋 <b>Watchers (/watchers)</b>: Pantauan posisi live trade (TP/SL)\n` +
          `• 📊 <b>Scan Watchlist (/scan)</b>: Scan pair koin di daftar pantauan\n` +
          `• ℹ️ <b>Help &amp; Status (/help)</b>: Info status bot &amp; panduan risiko`;

        await ctx.reply(menuText, {
          parse_mode: 'HTML',
          ...this.getMainInlineKeyboard()
        });
      } catch (err) {
        logger.error(`Error handling /menu: ${(err as Error).message}`);
      }
    };

    const handleScreener = async (ctx: any, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const tf = timeframe || this.config.trading.timeframe;
        await ctx.reply(`⏳ <i>Scanning 30 koin volume tertinggi di Binance (${tf}) untuk mencari peluang entry...</i>`, {
          parse_mode: 'HTML'
        });

        const { results, totalScanned } = await this.handlers.onScanScreener(30, tf);
        const text = formatScreenerMessage(results, totalScanned, tf);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard());
      } catch (err) {
        logger.error(`Error handling screener: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal melakukan screener market: ${escapeHtml((err as Error).message)}`);
      }
    };

    const handleScalp = async (ctx: any, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const tf = timeframe === '30m' ? '30m' : '15m';

        await ctx.reply(`⚡ <i>Memindai peluang momentum scalping cepat (${tf})...</i>`, {
          parse_mode: 'HTML'
        });

        const { results, totalScanned } = await this.handlers.onScanScalping(25, tf);
        const text = formatScalpingMessage(results, totalScanned, tf);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard());
      } catch (err) {
        logger.error(`Error handling /scalp: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal scan scalping: ${escapeHtml((err as Error).message)}`);
      }
    };

    const handleDaily = async (ctx: any, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const tf = timeframe || this.config.dailyTrading?.timeframe || '1h';
        await ctx.reply(`🎯 <i>Menganalisa setup peluang entry Daily Trading (${tf}) di Binance Spot...</i>`, {
          parse_mode: 'HTML'
        });

        const limit = this.config.dailyTrading?.limit || 3;
        const { results, totalScanned } = await this.handlers.onScanDaily(limit, tf);
        const text = formatDailyTradingMessage(results, totalScanned, tf, false);

        if (results.length > 0) {
          const buttons = results.map(r => [
            Markup.button.callback(`🔔 Notice Me: ${r.symbol.replace('USDT', '')}`, `notice:${r.symbol}:${r.timeframe}`)
          ]);
          await ctx.reply(text, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(buttons)
          });
        } else {
          await this.replySafe(ctx, text, this.getMainReplyKeyboard());
        }
      } catch (err) {
        logger.error(`Error handling /daily: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal analisa daily trading: ${escapeHtml((err as Error).message)}`);
      }
    };

    const handleWatchers = async (ctx: any) => {
      try {
        if (!this.watcherService) {
          await ctx.reply('ℹ️ Watcher service belum diaktifkan.');
          return;
        }
        const active = this.watcherService.getActiveWatchers();
        const text = formatWatchersListMessage(active);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard());
      } catch (err) {
        logger.error(`Error handling /watchers: ${(err as Error).message}`);
      }
    };

    const handleScan = async (ctx: any, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const tf = timeframe || this.config.trading.timeframe;
        await ctx.reply(`⏳ <i>Scanning watchlist pair (${tf})...</i>`, {
          parse_mode: 'HTML'
        });
        const results = await this.handlers.onScanAll(tf);
        const text = formatScanSummaryMessage(results);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard());
      } catch (err) {
        logger.error(`Error handling /scan: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal scan market: ${escapeHtml((err as Error).message)}`);
      }
    };

    // 2. Register bot commands
    this.bot.command('start', handleStart);
    this.bot.command('help', handleHelp);
    this.bot.command('status', handleStatus);
    this.bot.command('menu', handleMenu);

    this.bot.command(['screener', 'find', 'signals'], async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const tf = parts[1];
      await handleScreener(ctx, tf);
    });

    this.bot.command('scalp', async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const tf = parts[1] === '30m' ? '30m' : '15m';
      await handleScalp(ctx, tf);
    });

    this.bot.command(['daily', 'suggestion'], async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const tf = parts[1];
      await handleDaily(ctx, tf);
    });

    this.bot.command(['watchers', 'active'], handleWatchers);

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

    // /scan command
    this.bot.command('scan', async (ctx) => {
      try {
        const parts = ctx.message.text.trim().split(/\s+/);
        const arg = parts[1]?.toLowerCase();

        if (arg === 'all' || arg === 'top' || arg === 'market') {
          const tf = parts[2];
          await handleScreener(ctx, tf);
          return;
        }

        const tf = arg && /^\d+[mhd]$/.test(arg) ? arg : undefined;
        await handleScan(ctx, tf);
      } catch (err) {
        logger.error(`Error handling /scan: ${(err as Error).message}`);
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

    // 3. Callback Query Handlers
    // Notice Me clicked
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

    // Unwatch action button clicked
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

    // Menu callback actions
    this.bot.action('menu:find', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleScreener(ctx);
    });
    this.bot.action('menu:scalp', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleScalp(ctx);
    });
    this.bot.action('menu:daily', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleDaily(ctx);
    });
    this.bot.action('menu:watchers', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleWatchers(ctx);
    });
    this.bot.action('menu:scan', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleScan(ctx);
    });
    this.bot.action('menu:status', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleStatus(ctx);
    });
    this.bot.action('menu:help', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleHelp(ctx);
    });

    // 4. Text Message listener: Keyboard menu buttons & Dynamic Coin tickers
    this.bot.on('text', async (ctx, next) => {
      const rawText = ctx.message.text.trim();

      // Check persistent Reply Keyboard button presses:
      if (/^🔍.*(screener|find)/i.test(rawText) || rawText === '🔍 Screener (/find)') {
        await handleScreener(ctx);
        return;
      }
      if (/^⚡.*scalp/i.test(rawText) || rawText === '⚡ Scalp Radar (/scalp)') {
        await handleScalp(ctx);
        return;
      }
      if (/^🎯.*(daily|entry)/i.test(rawText) || rawText === '🎯 Daily Entry (/daily)') {
        await handleDaily(ctx);
        return;
      }
      if (/^📋.*watcher/i.test(rawText) || rawText === '📋 Watchers (/watchers)') {
        await handleWatchers(ctx);
        return;
      }
      if (/^📊.*scan/i.test(rawText) || rawText === '📊 Scan Watchlist (/scan)') {
        await handleScan(ctx);
        return;
      }
      if (/^ℹ️.*(help|status)/i.test(rawText) || rawText === 'ℹ️ Help & Status (/help)') {
        await handleHelp(ctx);
        return;
      }

      if (!rawText.startsWith('/')) {
        return next();
      }

      const parts = rawText.slice(1).split(/\s+/);
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
      // Register Telegram Bot native command menu (shown in Telegram's Menu button)
      try {
        await this.bot.telegram.setMyCommands([
          { command: 'menu', description: '📱 Buka menu tombol navigasi utama' },
          { command: 'find', description: '🔍 Screener 30 pair teraktif di Binance' },
          { command: 'scalp', description: '⚡ Scalping radar momentum (15m/30m)' },
          { command: 'daily', description: '🎯 Rekomendasi entry trading harian (1h)' },
          { command: 'watchers', description: '📋 Pantauan live trade aktif (TP/SL)' },
          { command: 'scan', description: '📊 Scan watchlist pair' },
          { command: 'status', description: '⚙️ Status operasional & scanner bot' },
          { command: 'help', description: '📖 Panduan lengkap & risk management' }
        ]);
        logger.info('Telegram Bot native command menu registered successfully');
      } catch (cmdErr) {
        logger.warn(`Could not set Telegram commands: ${(cmdErr as Error).message}`);
      }

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
   * Broadcast daily trading suggestions update to Telegram
   */
  public async sendDailyTradingUpdate(
    results: SignalResult[],
    totalScanned: number,
    timeframe: string,
    isAutomated: boolean = true
  ): Promise<boolean> {
    const text = formatDailyTradingMessage(results, totalScanned, timeframe, isAutomated);

    let inlineKeyboard;
    if (results.length > 0) {
      const buttons = results.map(r => [
        Markup.button.callback(`🔔 Notice Me: ${r.symbol.replace('USDT', '')}`, `notice:${r.symbol}:${r.timeframe}`)
      ]);
      inlineKeyboard = Markup.inlineKeyboard(buttons);
    }

    try {
      if (inlineKeyboard) {
        await this.bot.telegram.sendMessage(this.config.telegram.chatId, text, {
          parse_mode: 'HTML',
          ...inlineKeyboard
        });
      } else {
        await this.bot.telegram.sendMessage(this.config.telegram.chatId, text, {
          parse_mode: 'HTML'
        });
      }
      return true;
    } catch {
      return this.sendAlert(text);
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
