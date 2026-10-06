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
  BotStatusInfo,
  formatAdminDashboard,
  formatAdminUsersList,
  formatAdminUserDetail,
  formatNewUserRequestMessage,
  formatWaitingApprovalMessage,
  formatUserApprovedNotification,
  formatUserRejectedNotification,
  formatBinanceBalanceMessage,
  formatConnectInstructionsMessage,
  formatBuyConfirmMessage,
  formatOrderReceiptMessage,
  formatBinanceAccountNotLoggedInMessage,
  formatBinanceAccountLoggedInMessage,
  formatBinanceApiGuideMessage
} from './formatter.js';
import { SignalResult } from '../strategy/signal.js';
import { TradeWatcherService } from '../watcher/tradeWatcher.js';
import { UserManager } from '../user/userManager.js';
import { BinanceTradingClient } from '../exchange/binanceTrade.js';

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
  'cek',
  'admin',
  'users',
  'approve',
  'reject',
  'broadcast',
  'balance',
  'portfolio',
  'saldo',
  'connect',
  'binance',
  'account',
  'disconnect',
  'logout',
  'login',
  'cancel'
]);

export interface UserSessionState {
  step: 'AWAITING_API_KEY' | 'AWAITING_API_SECRET' | 'AWAITING_CUSTOM_BUY_AMOUNT';
  apiKey?: string;
  buySymbol?: string;
}

export class TelegramBotService {
  private bot: Telegraf;
  private config: AppConfig;
  private handlers?: TelegramBotHandlers;
  private watcherService?: TradeWatcherService;
  private userManager: UserManager;
  private tradingClient: BinanceTradingClient;
  private userSessionStates: Map<string, UserSessionState> = new Map();
  private isRunning = false;

  constructor(config: AppConfig, userManager?: UserManager) {
    this.config = config;
    this.bot = new Telegraf(config.telegram.token);
    this.userManager = userManager || new UserManager(config.telegram.adminChatId);
    this.tradingClient = new BinanceTradingClient(config.exchange.baseUrl);
  }

  /**
   * Access the UserManager instance
   */
  public getUserManager(): UserManager {
    return this.userManager;
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
  public getMainReplyKeyboard(isAdmin: boolean = false) {
    const buttons = [
      ['🔍 Screener (/find)', '⚡ Scalp Radar (/scalp)'],
      ['🎯 Daily Entry (/daily)', '📋 Watchers (/watchers)'],
      ['💼 Akun Binance', '📊 Scan Watchlist (/scan)'],
      ['ℹ️ Help & Status (/help)']
    ];

    if (isAdmin) {
      buttons.push(['👑 Admin Menu (/admin)']);
    }

    return Markup.keyboard(buttons).resize();
  }

  /**
   * Main interactive inline keyboard for /menu
   */
  public getMainInlineKeyboard(isAdmin: boolean = false) {
    const buttons = [
      [
        Markup.button.callback('🔍 Screener (/find)', 'menu:find'),
        Markup.button.callback('⚡ Scalp Radar (/scalp)', 'menu:scalp')
      ],
      [
        Markup.button.callback('🎯 Daily Entry (/daily)', 'menu:daily'),
        Markup.button.callback('📋 Watchers (/watchers)', 'menu:watchers')
      ],
      [
        Markup.button.callback('💼 Akun Binance', 'binance:hub'),
        Markup.button.callback('📊 Scan Watchlist (/scan)', 'menu:scan')
      ],
      [
        Markup.button.callback('⚙️ Bot Status (/status)', 'menu:status'),
        Markup.button.callback('📖 Panduan & Help (/help)', 'menu:help')
      ]
    ];

    if (isAdmin) {
      buttons.push([
        Markup.button.callback('👑 Admin Panel (/admin)', 'menu:admin')
      ]);
    }

    return Markup.inlineKeyboard(buttons);
  }

  /**
   * Admin interactive inline keyboard for /admin dashboard
   */
  public getAdminInlineKeyboard(pendingCount: number = 0) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('👥 Daftar Pengguna', 'admin:users'),
        Markup.button.callback(`⏳ Menunggu Approval (${pendingCount})`, 'admin:pending')
      ],
      [
        Markup.button.callback('📢 Info Broadcast', 'admin:broadcast_info'),
        Markup.button.callback('🔄 Refresh Dashboard', 'admin:menu')
      ],
      [
        Markup.button.callback('🏠 Menu Utama', 'admin:main_menu')
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

    // Security Middleware: User Registration & Admin Approval
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;

      const from = ctx.from;
      const { user, isNew } = this.userManager.registerOrUpdate(chatId, {
        username: from?.username,
        firstName: from?.first_name,
        lastName: from?.last_name
      });

      // Admin always has immediate access
      if (user.role === 'admin' || chatId === this.config.telegram.adminChatId) {
        return next();
      }

      // If user is brand new (and not admin), notify user & alert admin
      if (isNew) {
        logger.info(`New user registration request from Chat ID: ${chatId} (@${user.username || 'unknown'})`);

        // Send pending notification to user
        const pendingUserMsg = formatWaitingApprovalMessage(user);
        await ctx.reply(pendingUserMsg, { parse_mode: 'HTML' }).catch(() => {});

        // Send alert to admin with inline Approve & Reject buttons
        const adminAlertMsg = formatNewUserRequestMessage(user);
        const adminKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Setujui (Approve)', `admin:approve:${chatId}`),
            Markup.button.callback('❌ Tolak (Reject)', `admin:reject:${chatId}`)
          ]
        ]);

        await this.bot.telegram.sendMessage(this.config.telegram.adminChatId, adminAlertMsg, {
          parse_mode: 'HTML',
          ...adminKeyboard
        }).catch(err => {
          logger.error(`Failed to notify admin of new user request: ${(err as Error).message}`);
        });

        return;
      }

      // If user is still pending approval
      if (user.status === 'pending') {
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery('⏳ Akun Anda masih menunggu persetujuan Admin.', { show_alert: true }).catch(() => {});
        } else {
          const pendingMsg = formatWaitingApprovalMessage(user);
          await ctx.reply(pendingMsg, { parse_mode: 'HTML' }).catch(() => {});
        }
        return;
      }

      // If user was rejected
      if (user.status === 'rejected') {
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery('⛔ Akses Anda telah ditolak oleh Admin.', { show_alert: true }).catch(() => {});
        } else {
          await ctx.reply(formatUserRejectedNotification(), { parse_mode: 'HTML' }).catch(() => {});
        }
        return;
      }

      // If user was blocked
      if (user.status === 'blocked') {
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery().catch(() => {});
        }
        return;
      }

      // If user is approved, continue!
      if (user.status === 'approved') {
        return next();
      }

      return;
    });

    const exampleCoins = ['btc', 'eth', 'sol', 'sui', 'near', 'doge', 'pepe', 'xrp'];

    // 1. Helper handlers
    const handleStart = async (ctx: any) => {
      try {
        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
        const text = formatStartMessage(exampleCoins);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard(isAdmin));
      } catch (err) {
        logger.error(`Error handling /start: ${(err as Error).message}`);
      }
    };

    const handleHelp = async (ctx: any) => {
      try {
        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
        const text = formatHelpMessage();
        await this.replySafe(ctx, text, this.getMainReplyKeyboard(isAdmin));
      } catch (err) {
        logger.error(`Error handling /help: ${(err as Error).message}`);
      }
    };

    const handleStatus = async (ctx: any) => {
      try {
        if (!this.handlers) return;
        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
        const statusInfo = this.handlers.getStatusInfo();
        const text = formatBotStatusMessage(statusInfo);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard(isAdmin));
      } catch (err) {
        logger.error(`Error handling /status: ${(err as Error).message}`);
      }
    };

    const handleMenu = async (ctx: any) => {
      try {
        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
        let menuText = `📱 <b>CHAEWON CRYPTO SIGNAL — MAIN MENU</b>\n\n` +
          `Pilih perintah melalui tombol menu interaktif berikut atau gunakan tombol keyboard di bawah layar:\n\n` +
          `• 🔍 <b>Screener (/find)</b>: Scan 30 koin aktif di Binance\n` +
          `• ⚡ <b>Scalp Radar (/scalp)</b>: Momentum cepat timeframe 15m/30m\n` +
          `• 🎯 <b>Daily Entry (/daily)</b>: Rekomendasi entry trading harian (1h)\n` +
          `• 📋 <b>Watchers (/watchers)</b>: Pantauan posisi live trade (TP/SL)\n` +
          `• 💼 <b>Akun Binance</b>: Cek portofolio saldo live &amp; 1-Click Buy\n` +
          `• 📊 <b>Scan Watchlist (/scan)</b>: Scan pair koin di daftar pantauan\n` +
          `• ℹ️ <b>Help &amp; Status (/help)</b>: Info status bot &amp; panduan risiko`;

        if (isAdmin) {
          menuText += `\n• 👑 <b>Admin Panel (/admin)</b>: Kelola pengguna &amp; persetujuan`;
        }

        await ctx.reply(menuText, {
          parse_mode: 'HTML',
          ...this.getMainInlineKeyboard(isAdmin)
        });
      } catch (err) {
        logger.error(`Error handling /menu: ${(err as Error).message}`);
      }
    };

    const handleAdminMenu = async (ctx: any) => {
      try {
        const chatId = ctx.chat?.id?.toString() || '';
        if (!this.userManager.isAdmin(chatId)) {
          await ctx.reply('⛔ Perintah ini hanya dapat diakses oleh Admin.');
          return;
        }

        const stats = this.userManager.getStats();
        const text = formatAdminDashboard(stats);
        await ctx.reply(text, {
          parse_mode: 'HTML',
          ...this.getAdminInlineKeyboard(stats.pending)
        });
      } catch (err) {
        logger.error(`Error handling /admin: ${(err as Error).message}`);
      }
    };

    const handleScreener = async (ctx: any, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
        const tf = timeframe || this.config.trading.timeframe;
        await ctx.reply(`⏳ <i>Scanning 30 koin volume tertinggi di Binance (${tf}) untuk mencari peluang entry...</i>`, {
          parse_mode: 'HTML'
        });

        const { results, totalScanned } = await this.handlers.onScanScreener(30, tf);
        const text = formatScreenerMessage(results, totalScanned, tf);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard(isAdmin));
      } catch (err) {
        logger.error(`Error handling screener: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal melakukan screener market: ${escapeHtml((err as Error).message)}`);
      }
    };

    const handleScalp = async (ctx: any, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
        const tf = timeframe === '30m' ? '30m' : '15m';

        await ctx.reply(`⚡ <i>Memindai peluang momentum scalping cepat (${tf})...</i>`, {
          parse_mode: 'HTML'
        });

        const { results, totalScanned } = await this.handlers.onScanScalping(25, tf);
        const text = formatScalpingMessage(results, totalScanned, tf);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard(isAdmin));
      } catch (err) {
        logger.error(`Error handling /scalp: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal scan scalping: ${escapeHtml((err as Error).message)}`);
      }
    };

    const handleDaily = async (ctx: any, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
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
          await this.replySafe(ctx, text, this.getMainReplyKeyboard(isAdmin));
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
        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
        const parts = ctx.message?.text?.trim().split(/\s+/) || [];
        const showAll = isAdmin && parts[1]?.toLowerCase() === 'all';

        // Refresh live prices from exchange immediately so user gets 100% fresh data
        await this.watcherService.checkWatchers();

        const active = this.watcherService.getActiveWatchers(showAll ? undefined : chatId);
        const text = formatWatchersListMessage(active);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard(isAdmin));
      } catch (err) {
        logger.error(`Error handling /watchers: ${(err as Error).message}`);
      }
    };

    const handleScan = async (ctx: any, timeframe?: string) => {
      try {
        if (!this.handlers) return;
        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
        const tf = timeframe || this.config.trading.timeframe;
        await ctx.reply(`⏳ <i>Scanning watchlist pair (${tf})...</i>`, {
          parse_mode: 'HTML'
        });
        const results = await this.handlers.onScanAll(tf);
        const text = formatScanSummaryMessage(results);
        await this.replySafe(ctx, text, this.getMainReplyKeyboard(isAdmin));
      } catch (err) {
        logger.error(`Error handling /scan: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal scan market: ${escapeHtml((err as Error).message)}`);
      }
    };

    const handleBinanceHub = async (ctx: any, editMessage: boolean = false) => {
      try {
        const chatId = ctx.chat?.id?.toString() || '';
        const hasLogin = this.userManager.hasBinance(chatId);

        if (!hasLogin) {
          const text = formatBinanceAccountNotLoggedInMessage();
          const keyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('🔑 Hubungkan Akun (Input API Key)', 'binance:login'),
              Markup.button.callback('📖 Panduan Buat API Key', 'binance:guide')
            ],
            [
              Markup.button.callback('« Menu Utama', 'menu:main')
            ]
          ]);

          if (editMessage && ctx.callbackQuery) {
            await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => ctx.reply(text, { parse_mode: 'HTML', ...keyboard }));
          } else {
            await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
          }
          return;
        }

        // User is logged in: show Profile & Portfolio
        const creds = this.userManager.getBinanceCredentials(chatId);
        const maskedKey = this.userManager.getMaskedBinanceApiKey(chatId) || '****';

        if (!creds) {
          await ctx.reply('⚠️ Kredensial tidak ditemukan. Silakan hubungkan ulang akun Binance Anda.');
          return;
        }

        let waitMsg: any = null;
        if (!editMessage) {
          waitMsg = await ctx.reply('⏳ <i>Mengambil data akun & saldo live dari Binance...</i>', { parse_mode: 'HTML' });
        }

        try {
          const info = await this.tradingClient.getAccountBalances(creds.apiKey, creds.apiSecret);
          if (waitMsg) {
            await ctx.deleteMessage(waitMsg.message_id).catch(() => {});
          }

          const text = formatBinanceAccountLoggedInMessage(info, maskedKey);
          const keyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('🔄 Refresh Saldo', 'binance:refresh'),
              Markup.button.callback('🔄 Ganti API Key', 'binance:relogin')
            ],
            [
              Markup.button.callback('❌ Putuskan Akun (Logout)', 'binance:logout'),
              Markup.button.callback('« Menu Utama', 'menu:main')
            ]
          ]);

          if (editMessage && ctx.callbackQuery) {
            await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard }).catch(() => ctx.reply(text, { parse_mode: 'HTML', ...keyboard }));
          } else {
            await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
          }
        } catch (fetchErr: any) {
          if (waitMsg) {
            await ctx.deleteMessage(waitMsg.message_id).catch(() => {});
          }
          const errText = `💼 <b>AKUN BINANCE SAYA</b>\n\n` +
            `👤 <b>Status Akun:</b> ⚠️ <b>Koneksi Bermasalah</b>\n` +
            `🔑 <b>API Key:</b> <code>${escapeHtml(maskedKey)}</code>\n\n` +
            `❌ <b>Gagal mengambil data dari Binance:</b>\n` +
            `<i>${escapeHtml(fetchErr.message)}</i>\n\n` +
            `💡 <i>Pastikan API Key masih aktif dan permission Reading dicentang di Binance.</i>`;

          const keyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('🔄 Coba Refresh Lagi', 'binance:refresh'),
              Markup.button.callback('🔄 Ganti API Key', 'binance:relogin')
            ],
            [
              Markup.button.callback('❌ Putuskan Akun (Logout)', 'binance:logout'),
              Markup.button.callback('« Menu Utama', 'menu:main')
            ]
          ]);

          if (editMessage && ctx.callbackQuery) {
            await ctx.editMessageText(errText, { parse_mode: 'HTML', ...keyboard }).catch(() => ctx.reply(errText, { parse_mode: 'HTML', ...keyboard }));
          } else {
            await ctx.reply(errText, { parse_mode: 'HTML', ...keyboard });
          }
        }
      } catch (err) {
        logger.error(`Error handling Binance Account Hub: ${(err as Error).message}`);
      }
    };

    const handleDisconnect = async (ctx: any) => {
      try {
        const chatId = ctx.chat?.id?.toString() || '';
        const hasConnected = this.userManager.hasBinance(chatId);
        if (!hasConnected) {
          await ctx.reply('ℹ️ Tidak ada akun Binance yang terhubung saat ini.');
          return;
        }

        const text = `⚠️ <b>KONFIRMASI PUTUSKAN AKUN (LOGOUT)</b>\n\n` +
          `Apakah Anda yakin ingin memutuskan sambungan akun Binance?\n` +
          `Kredensial API Key yang tersimpan akan dihapus secara permanen dari bot.`;
        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Ya, Putuskan Akun', 'binance:logout_confirm'),
            Markup.button.callback('❌ Batal', 'binance:hub')
          ]
        ]);
        await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
      } catch (err) {
        logger.error(`Error handling /disconnect: ${(err as Error).message}`);
      }
    };

    // 2. Register bot commands
    this.bot.command('start', handleStart);
    this.bot.command('help', handleHelp);
    this.bot.command('status', handleStatus);
    this.bot.command('menu', handleMenu);
    this.bot.command(['binance', 'account', 'connect', 'balance', 'portfolio', 'saldo'], (ctx) => handleBinanceHub(ctx));
    this.bot.command(['disconnect', 'logout'], handleDisconnect);
    this.bot.command('cancel', async (ctx) => {
      const chatId = ctx.chat?.id?.toString() || '';
      if (this.userSessionStates.has(chatId)) {
        this.userSessionStates.delete(chatId);
        await ctx.reply('✅ Tindakan berhasil dibatalkan.');
      } else {
        await ctx.reply('ℹ️ Tidak ada proses yang sedang berjalan.');
      }
    });

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

        const chatId = ctx.chat?.id?.toString();
        if (this.watcherService && chatId) {
          const removed = this.watcherService.removeWatcher(sym, chatId);
          if (removed) {
            await ctx.reply(`✅ Pemantauan live untuk <b>${formatSymbolDisplay(sym)}</b> telah dibatalkan.`, {
              parse_mode: 'HTML'
            });
          } else {
            await ctx.reply(`ℹ️ <b>${formatSymbolDisplay(sym)}</b> tidak ditemukan di daftar pantauan aktif Anda.`, {
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

        // Attach "Notice Me" and "Beli Spot" action buttons
        const inlineKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🔔 Notice Me (Pantau)', `notice:${result.symbol}:${result.timeframe}`),
            Markup.button.callback('🛒 Beli Spot', `buy:${result.symbol}`)
          ]
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

        // Trigger immediate live price check in background
        setTimeout(() => {
          this.watcherService?.checkWatchers().catch(() => {});
        }, 500);
      } catch (err) {
        logger.error(`Error in Notice Me action: ${(err as Error).message}`);
        await ctx.answerCbQuery('❌ Gagal mengaktifkan Notice Me.').catch(() => {});
      }
    });

    // Unwatch action button clicked
    this.bot.action(/^unwatch:([A-Z0-9]+)$/i, async (ctx) => {
      try {
        const symbol = ctx.match[1].toUpperCase();
        const chatId = ctx.chat?.id?.toString();
        if (this.watcherService && chatId) {
          this.watcherService.removeWatcher(symbol, chatId);
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
    this.bot.action('menu:admin', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleAdminMenu(ctx);
    });

    this.bot.action(['menu:balance', 'menu:connect', 'binance:hub'], async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleBinanceHub(ctx, true);
    });

    this.bot.action('binance:refresh', async (ctx) => {
      await ctx.answerCbQuery('Memperbarui saldo...').catch(() => {});
      await handleBinanceHub(ctx, true);
    });

    this.bot.action(['connect:start', 'binance:login', 'binance:relogin'], async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const chatId = ctx.chat?.id?.toString() || '';
      this.userSessionStates.set(chatId, { step: 'AWAITING_API_KEY' });
      await ctx.reply(
        `🔑 <b>LANGKAH 1/2: Masukkan API Key Binance</b>\n\n` +
        `Silakan kirimkan (paste) <b>API Key</b> akun Binance Anda ke chat ini:\n\n` +
        `🔒 <i>Pesan Anda akan otomatis langsung dihapus oleh bot demi privasi dan keamanan riwayat chat.</i>\n\n` +
        `💡 <i>Ketik /cancel atau klik tombol di bawah untuk membatalkan.</i>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Batalkan', 'binance:cancel_input')]
          ])
        }
      );
    });

    this.bot.action('binance:guide', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const text = formatBinanceApiGuideMessage();
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔑 Lanjut Input API Key', 'binance:login')],
          [Markup.button.callback('« Kembali ke Akun Binance', 'binance:hub')]
        ])
      }).catch(() => {});
    });

    this.bot.action('binance:logout', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const text = `⚠️ <b>KONFIRMASI PUTUSKAN AKUN (LOGOUT)</b>\n\n` +
        `Apakah Anda yakin ingin memutuskan sambungan akun Binance?\n` +
        `Kredensial API Key yang tersimpan akan dihapus secara permanen dari bot.`;
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Ya, Putuskan Akun', 'binance:logout_confirm'),
            Markup.button.callback('❌ Batal', 'binance:hub')
          ]
        ])
      }).catch(() => {});
    });

    this.bot.action(['connect:disconnect', 'binance:logout_confirm'], async (ctx) => {
      const chatId = ctx.chat?.id?.toString() || '';
      this.userManager.removeBinanceCredentials(chatId);
      await ctx.answerCbQuery('Akun Binance berhasil diputuskan.').catch(() => {});
      await ctx.reply('✅ <b>Akun Binance berhasil diputuskan!</b>\n\nKredensial API Key telah dihapus secara permanen dari sistem.', { parse_mode: 'HTML' });
      await handleBinanceHub(ctx, false);
    });

    this.bot.action('binance:cancel_input', async (ctx) => {
      const chatId = ctx.chat?.id?.toString() || '';
      this.userSessionStates.delete(chatId);
      await ctx.answerCbQuery('Input API Key dibatalkan.').catch(() => {});
      await ctx.reply('✅ Input API Key berhasil dibatalkan.');
      await handleBinanceHub(ctx, false);
    });

    this.bot.action('menu:main', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleMenu(ctx);
    });

    // 1-Click Buy Actions
    this.bot.action(/^buy:([A-Z0-9]+)$/i, async (ctx) => {
      try {
        const symbol = ctx.match[1].toUpperCase();
        const chatId = ctx.chat?.id?.toString() || '';

        const creds = this.userManager.getBinanceCredentials(chatId);
        if (!creds) {
          await ctx.answerCbQuery('⚠️ Akun Binance belum terhubung.');
          await ctx.reply(
            `⚠️ <b>AKUN BINANCE BELUM TERHUBUNG</b>\n\n` +
            `Untuk mengeksekusi pembelian 1-Click Spot untuk <b>${formatSymbolDisplay(symbol)}</b>, silakan hubungkan API Key Binance Anda terlebih dahulu.`,
            {
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('💼 Hubungkan Akun Sekarang', 'binance:login')]
              ])
            }
          );
          return;
        }

        if (!creds.canTrade) {
          await ctx.answerCbQuery('⚠️ Izin trading tidak aktif di API Key Anda.');
          await ctx.reply(
            `⚠️ <b>IZIN TRADING TIDAK AKTIF</b>\n\n` +
            `API Key Anda saat ini dalam mode <i>Read-Only</i>. Pastikan Anda mencentang opsi <b>Enable Spot &amp; Margin Trading</b> pada menu API Management di Binance.`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        await ctx.answerCbQuery();

        let freeUsdt = 0;
        try {
          const accInfo = await this.tradingClient.getAccountBalances(creds.apiKey, creds.apiSecret);
          const usdtItem = accInfo.balances.find(b => b.asset === 'USDT');
          freeUsdt = usdtItem ? usdtItem.free : 0;
        } catch {}

        const text = `🛒 <b>PILIH NOMINAL BELI SPOT: ${formatSymbolDisplay(symbol)}</b>\n\n` +
          `💵 Saldo USDT Tersedia: <b>$${freeUsdt.toFixed(2)} USDT</b>\n` +
          `Pilih nominal USDT yang ingin dibelanjakan:`;

        await ctx.reply(text, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('💵 10 USDT', `buy_amt:${symbol}:10`),
              Markup.button.callback('💵 25 USDT', `buy_amt:${symbol}:25`)
            ],
            [
              Markup.button.callback('💵 50 USDT', `buy_amt:${symbol}:50`),
              Markup.button.callback('💵 100 USDT', `buy_amt:${symbol}:100`)
            ],
            [
              Markup.button.callback('✏️ Nominal Kustom', `buy_amt:${symbol}:custom`),
              Markup.button.callback('❌ Batal', 'buy:cancel')
            ]
          ])
        });
      } catch (err) {
        logger.error(`Error in buy action: ${(err as Error).message}`);
        await ctx.answerCbQuery('❌ Gagal memproses order.').catch(() => {});
      }
    });

    this.bot.action(/^buy_amt:([A-Z0-9]+):([0-9.]+|custom)$/i, async (ctx) => {
      try {
        const symbol = ctx.match[1].toUpperCase();
        const amtStr = ctx.match[2];
        const chatId = ctx.chat?.id?.toString() || '';

        await ctx.answerCbQuery().catch(() => {});

        if (amtStr === 'custom') {
          this.userSessionStates.set(chatId, {
            step: 'AWAITING_CUSTOM_BUY_AMOUNT',
            buySymbol: symbol
          });
          await ctx.reply(
            `✏️ <b>Ketik nominal USDT yang ingin dibeli untuk ${formatSymbolDisplay(symbol)}:</b>\n\n` +
            `Contoh: ketik <code>15</code> atau <code>75</code> (minimal $5.00 USDT).\n` +
            `💡 <i>Ketik /cancel untuk membatalkan.</i>`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        const usdtAmount = parseFloat(amtStr);
        if (isNaN(usdtAmount) || usdtAmount < 5) {
          await ctx.reply('❌ Nominal pembelian minimal $5.00 USDT.');
          return;
        }

        const creds = this.userManager.getBinanceCredentials(chatId);
        if (!creds) return;

        let currentPrice = 0;
        let freeUsdt = 0;
        try {
          if (this.handlers) {
            const scanRes = await this.handlers.onScanSymbol(symbol);
            currentPrice = scanRes.entryPrice;
          }
          const accInfo = await this.tradingClient.getAccountBalances(creds.apiKey, creds.apiSecret);
          const usdtItem = accInfo.balances.find(b => b.asset === 'USDT');
          freeUsdt = usdtItem ? usdtItem.free : 0;
        } catch {}

        const confirmMsg = formatBuyConfirmMessage(symbol, usdtAmount, currentPrice, freeUsdt);
        await ctx.reply(confirmMsg, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Ya, Eksekusi Beli', `buy_confirm:${symbol}:${usdtAmount}`),
              Markup.button.callback('❌ Batalkan', 'buy:cancel')
            ]
          ])
        });
      } catch (err) {
        logger.error(`Error in buy_amt action: ${(err as Error).message}`);
      }
    });

    this.bot.action(/^buy_confirm:([A-Z0-9]+):([0-9.]+)$/i, async (ctx) => {
      try {
        const symbol = ctx.match[1].toUpperCase();
        const usdtAmount = parseFloat(ctx.match[2]);
        const chatId = ctx.chat?.id?.toString() || '';

        await ctx.answerCbQuery('⏳ Mengeksekusi order di Binance...').catch(() => {});

        const creds = this.userManager.getBinanceCredentials(chatId);
        if (!creds) {
          await ctx.reply('❌ Kredensial Binance tidak ditemukan. Silakan hubungkan ulang via /connect.');
          return;
        }

        const waitMsg = await ctx.reply(`⏳ <i>Mengirim Market Order $${usdtAmount.toFixed(2)} USDT ke Binance Spot...</i>`, { parse_mode: 'HTML' });

        const orderResult = await this.tradingClient.executeMarketBuy(
          creds.apiKey,
          creds.apiSecret,
          symbol,
          usdtAmount
        );

        await ctx.deleteMessage(waitMsg.message_id).catch(() => {});

        const receiptMsg = formatOrderReceiptMessage(orderResult);
        await ctx.reply(receiptMsg, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔔 Pasang Pantauan TP/SL (Notice Me)', `notice:${symbol}:15m`)]
          ])
        });
      } catch (err) {
        logger.error(`Error executing buy order: ${(err as Error).message}`);
        await ctx.reply(`❌ <b>Eksekusi Order Gagal!</b>\n\nAlasan: ${escapeHtml((err as Error).message)}`, { parse_mode: 'HTML' });
      }
    });

    this.bot.action('buy:cancel', async (ctx) => {
      await ctx.answerCbQuery('❌ Pembelian dibatalkan.').catch(() => {});
      await ctx.reply('❌ Pembelian spot telah dibatalkan.');
    });

    // 4. Admin Menu & User Management Callbacks
    this.bot.action('admin:menu', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        const stats = this.userManager.getStats();
        const text = formatAdminDashboard(stats);
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...this.getAdminInlineKeyboard(stats.pending)
        });
      } catch {
        await handleAdminMenu(ctx);
      }
    });

    this.bot.action('admin:main_menu', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handleMenu(ctx);
    });

    this.bot.action('admin:broadcast_info', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const text = `📢 <b>PANDUAN BROADCAST PESAN</b>\n\n` +
        `Untuk mengirim pesan siaran ke seluruh pengguna yang telah disetujui, gunakan perintah:\n\n` +
        `<code>/broadcast &lt;isi pesan Anda&gt;</code>\n\n` +
        `<b>Contoh:</b>\n<code>/broadcast Mohon perhatian, market sedang volatil tinggi hari ini.</code>`;
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Dashboard', 'admin:menu')]
        ])
      });
    });

    this.bot.action('admin:users', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        const users = this.userManager.getAllUsers();
        const text = formatAdminUsersList(users);

        const buttons: any[] = [];
        const recent = users.slice(0, 6);
        for (const u of recent) {
          const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.id;
          buttons.push([Markup.button.callback(`👤 Kelola: ${name.slice(0, 20)}`, `admin:user:${u.id}`)]);
        }
        buttons.push([Markup.button.callback('🔙 Kembali ke Dashboard', 'admin:menu')]);

        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (err) {
        logger.error(`Error in admin:users callback: ${(err as Error).message}`);
      }
    });

    this.bot.action('admin:pending', async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        const pending = this.userManager.getPendingUsers();
        if (pending.length === 0) {
          await ctx.editMessageText(
            `⏳ <b>ANTREAN PERSETUJUAN PENGGUNA</b>\n\n<i>Saat ini tidak ada pengguna yang menunggu persetujuan.</i>`,
            {
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Kembali ke Dashboard', 'admin:menu')]
              ])
            }
          );
          return;
        }

        let text = `⏳ <b>MENUNGGU PERSETUJUAN (${pending.length})</b>\n\n`;
        const buttons: any[] = [];

        pending.forEach((u, i) => {
          const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'User';
          const username = u.username ? `@${escapeHtml(u.username)}` : '-';
          text += `<b>${i + 1}. ${escapeHtml(name)}</b> (${username})\n`;
          text += `   • ID: <code>${u.id}</code>\n`;
          text += `   • Waktu: ${new Date(u.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n`;

          buttons.push([
            Markup.button.callback(`✅ Setujui ${name.slice(0, 12)}`, `admin:approve:${u.id}`),
            Markup.button.callback(`❌ Tolak`, `admin:reject:${u.id}`)
          ]);
        });

        buttons.push([Markup.button.callback('🔙 Kembali ke Dashboard', 'admin:menu')]);

        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (err) {
        logger.error(`Error in admin:pending callback: ${(err as Error).message}`);
      }
    });

    this.bot.action(/^admin:user:(\d+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => {});
        const targetId = ctx.match[1];
        const user = this.userManager.getUser(targetId);
        if (!user) {
          await ctx.reply('❌ User tidak ditemukan.');
          return;
        }

        const text = formatAdminUserDetail(user);
        const buttons: any[] = [];

        if (user.status === 'pending') {
          buttons.push([
            Markup.button.callback('✅ Setujui (Approve)', `admin:approve:${user.id}`),
            Markup.button.callback('❌ Tolak (Reject)', `admin:reject:${user.id}`)
          ]);
        } else if (user.status === 'approved') {
          if (user.role !== 'admin') {
            buttons.push([
              Markup.button.callback('❌ Cabut Akses (Reject)', `admin:reject:${user.id}`)
            ]);
          }
        } else if (user.status === 'rejected') {
          buttons.push([
            Markup.button.callback('✅ Setujui Kembali (Approve)', `admin:approve:${user.id}`)
          ]);
        }

        if (user.role !== 'admin') {
          buttons.push([
            Markup.button.callback('🗑️ Hapus User dari DB', `admin:delete:${user.id}`)
          ]);
        }

        buttons.push([Markup.button.callback('🔙 Kembali ke Daftar', 'admin:users')]);

        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (err) {
        logger.error(`Error in admin:user callback: ${(err as Error).message}`);
      }
    });

    this.bot.action(/^admin:approve:(\d+)$/, async (ctx) => {
      try {
        const targetChatId = ctx.match[1];
        const adminChatId = ctx.chat?.id?.toString() || '';

        if (!this.userManager.isAdmin(adminChatId)) {
          await ctx.answerCbQuery('❌ Hanya admin yang dapat menyetujui user.', { show_alert: true });
          return;
        }

        const approvedUser = this.userManager.approveUser(targetChatId);
        if (!approvedUser) {
          await ctx.answerCbQuery('❌ User tidak ditemukan.');
          return;
        }

        await ctx.answerCbQuery(`✅ User disetujui!`);

        const displayName = [approvedUser.firstName, approvedUser.lastName].filter(Boolean).join(' ') || approvedUser.username || targetChatId;
        await ctx.editMessageText(
          `✅ <b>USER BERHASIL DISETUJUI</b>\n\nUser <b>${escapeHtml(displayName)}</b> (ID: <code>${targetChatId}</code>) telah diaktifkan dan dapat menggunakan bot.`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('👤 Kelola User', `admin:user:${targetChatId}`)],
              [Markup.button.callback('🔙 Dashboard Admin', 'admin:menu')]
            ])
          }
        ).catch(async () => {
          await ctx.reply(`✅ User <b>${escapeHtml(displayName)}</b> (ID: <code>${targetChatId}</code>) telah disetujui.`, { parse_mode: 'HTML' });
        });

        // Notify user
        await this.bot.telegram.sendMessage(targetChatId, formatUserApprovedNotification(), {
          parse_mode: 'HTML',
          ...this.getMainReplyKeyboard(false)
        }).catch(err => {
          logger.warn(`Could not send approval notification to user ${targetChatId}: ${(err as Error).message}`);
        });
      } catch (err) {
        logger.error(`Error in admin:approve action: ${(err as Error).message}`);
      }
    });

    this.bot.action(/^admin:reject:(\d+)$/, async (ctx) => {
      try {
        const targetChatId = ctx.match[1];
        const adminChatId = ctx.chat?.id?.toString() || '';

        if (!this.userManager.isAdmin(adminChatId)) {
          await ctx.answerCbQuery('❌ Hanya admin yang dapat menolak user.', { show_alert: true });
          return;
        }

        const rejectedUser = this.userManager.rejectUser(targetChatId);
        if (!rejectedUser) {
          await ctx.answerCbQuery('❌ User tidak ditemukan.');
          return;
        }

        await ctx.answerCbQuery(`❌ User ditolak.`);

        const displayName = [rejectedUser.firstName, rejectedUser.lastName].filter(Boolean).join(' ') || rejectedUser.username || targetChatId;
        await ctx.editMessageText(
          `❌ <b>USER DITOLAK</b>\n\nPermintaan akses dari <b>${escapeHtml(displayName)}</b> (ID: <code>${targetChatId}</code>) telah ditolak.`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('👤 Kelola User', `admin:user:${targetChatId}`)],
              [Markup.button.callback('🔙 Dashboard Admin', 'admin:menu')]
            ])
          }
        ).catch(async () => {
          await ctx.reply(`❌ User <b>${escapeHtml(displayName)}</b> (ID: <code>${targetChatId}</code>) telah ditolak.`, { parse_mode: 'HTML' });
        });

        // Notify user
        await this.bot.telegram.sendMessage(targetChatId, formatUserRejectedNotification(), {
          parse_mode: 'HTML'
        }).catch(() => {});
      } catch (err) {
        logger.error(`Error in admin:reject action: ${(err as Error).message}`);
      }
    });

    this.bot.action(/^admin:delete:(\d+)$/, async (ctx) => {
      try {
        const targetChatId = ctx.match[1];
        const adminChatId = ctx.chat?.id?.toString() || '';

        if (!this.userManager.isAdmin(adminChatId)) {
          await ctx.answerCbQuery('❌ Hanya admin yang dapat menghapus user.', { show_alert: true });
          return;
        }

        const deleted = this.userManager.deleteUser(targetChatId);
        if (deleted) {
          await ctx.answerCbQuery('🗑️ User berhasil dihapus.');
          await ctx.editMessageText(
            `🗑️ <b>USER DIHAPUS</b>\n\nData user dengan ID <code>${targetChatId}</code> telah dihapus dari database.`,
            {
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Daftar Pengguna', 'admin:users')],
                [Markup.button.callback('🔙 Dashboard Admin', 'admin:menu')]
              ])
            }
          );
        } else {
          await ctx.answerCbQuery('❌ Gagal menghapus user.');
        }
      } catch (err) {
        logger.error(`Error in admin:delete action: ${(err as Error).message}`);
      }
    });

    // 5. Admin Slash Commands
    this.bot.command('admin', handleAdminMenu);

    this.bot.command('users', async (ctx) => {
      const chatId = ctx.chat?.id?.toString() || '';
      if (!this.userManager.isAdmin(chatId)) {
        await ctx.reply('⛔ Perintah ini hanya dapat diakses oleh Admin.');
        return;
      }
      const users = this.userManager.getAllUsers();
      const text = formatAdminUsersList(users);
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Kembali ke Dashboard', 'admin:menu')]
        ])
      });
    });

    this.bot.command('approve', async (ctx) => {
      const chatId = ctx.chat?.id?.toString() || '';
      if (!this.userManager.isAdmin(chatId)) {
        await ctx.reply('⛔ Perintah ini hanya dapat diakses oleh Admin.');
        return;
      }
      const parts = ctx.message.text.trim().split(/\s+/);
      const targetId = parts[1];
      if (!targetId) {
        await ctx.reply('⚠️ Format: <code>/approve &lt;ChatID&gt;</code>\n\nContoh: <code>/approve 12345678</code>', {
          parse_mode: 'HTML'
        });
        return;
      }

      const approved = this.userManager.approveUser(targetId);
      if (!approved) {
        await ctx.reply(`❌ User dengan Chat ID <code>${targetId}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
        return;
      }

      const displayName = [approved.firstName, approved.lastName].filter(Boolean).join(' ') || approved.username || targetId;
      await ctx.reply(`✅ User <b>${escapeHtml(displayName)}</b> (ID: <code>${targetId}</code>) berhasil disetujui!`, {
        parse_mode: 'HTML'
      });

      // Notify user
      await this.bot.telegram.sendMessage(targetId, formatUserApprovedNotification(), {
        parse_mode: 'HTML',
        ...this.getMainReplyKeyboard(false)
      }).catch(err => {
        logger.warn(`Could not send approval notice to user ${targetId}: ${(err as Error).message}`);
      });
    });

    this.bot.command('reject', async (ctx) => {
      const chatId = ctx.chat?.id?.toString() || '';
      if (!this.userManager.isAdmin(chatId)) {
        await ctx.reply('⛔ Perintah ini hanya dapat diakses oleh Admin.');
        return;
      }
      const parts = ctx.message.text.trim().split(/\s+/);
      const targetId = parts[1];
      if (!targetId) {
        await ctx.reply('⚠️ Format: <code>/reject &lt;ChatID&gt;</code>\n\nContoh: <code>/reject 12345678</code>', {
          parse_mode: 'HTML'
        });
        return;
      }

      const rejected = this.userManager.rejectUser(targetId);
      if (!rejected) {
        await ctx.reply(`❌ User dengan Chat ID <code>${targetId}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
        return;
      }

      const displayName = [rejected.firstName, rejected.lastName].filter(Boolean).join(' ') || rejected.username || targetId;
      await ctx.reply(`❌ User <b>${escapeHtml(displayName)}</b> (ID: <code>${targetId}</code>) telah ditolak.`, {
        parse_mode: 'HTML'
      });

      // Notify user
      await this.bot.telegram.sendMessage(targetId, formatUserRejectedNotification(), {
        parse_mode: 'HTML'
      }).catch(() => {});
    });

    this.bot.command('broadcast', async (ctx) => {
      const chatId = ctx.chat?.id?.toString() || '';
      if (!this.userManager.isAdmin(chatId)) {
        await ctx.reply('⛔ Perintah ini hanya dapat digunakan oleh Admin.');
        return;
      }

      const text = ctx.message.text.replace(/^\/broadcast(\s+)?/, '').trim();
      if (!text) {
        await ctx.reply(
          '⚠️ <b>Format Broadcast:</b>\n<code>/broadcast &lt;pesan Anda&gt;</code>\n\n<b>Contoh:</b>\n<code>/broadcast Halo semuanya, analisa koin hari ini telah diupdate!</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const approved = this.userManager.getApprovedUsers();
      let sentCount = 0;
      const broadcastMsg = `📢 <b>PENGUMUMAN DARI ADMIN</b>\n\n${escapeHtml(text)}`;

      await ctx.reply(`⏳ Mengirim broadcast ke ${approved.length} pengguna aktif...`);

      for (const u of approved) {
        try {
          await this.bot.telegram.sendMessage(u.id, broadcastMsg, { parse_mode: 'HTML' });
          sentCount++;
        } catch (err: any) {
          logger.warn(`Failed broadcast to user ${u.id}: ${err.message}`);
          if (err.description?.includes('bot was blocked') || err.message?.includes('blocked')) {
            this.userManager.blockUser(u.id);
          }
        }
      }

      await ctx.reply(`✅ Broadcast selesai! Berhasil terkirim ke <b>${sentCount}/${approved.length}</b> pengguna.`, {
        parse_mode: 'HTML'
      });
    });

    // 6. Text Message listener: Keyboard menu buttons, interactive wizards & Dynamic Coin tickers
    this.bot.on('text', async (ctx, next) => {
      const rawText = ctx.message.text.trim();
      const chatId = ctx.chat?.id?.toString() || '';

      // Check active interactive session states (connecting Binance or Custom buy amount)
      const session = this.userSessionStates.get(chatId);
      if (session) {
        if (rawText.toLowerCase() === '/cancel') {
          this.userSessionStates.delete(chatId);
          await ctx.reply('✅ Tindakan berhasil dibatalkan.');
          return;
        }

        if (session.step === 'AWAITING_API_KEY') {
          // Immediately delete user message containing API key
          await ctx.deleteMessage().catch(() => {});
          const apiKey = rawText.trim();
          if (apiKey.length < 16) {
            await ctx.reply('⚠️ Format API Key tampak terlalu pendek. Silakan salin & kirimkan kembali API Key Binance Anda (atau ketik /cancel):');
            return;
          }

          this.userSessionStates.set(chatId, {
            step: 'AWAITING_API_SECRET',
            apiKey
          });

          await ctx.reply(
            `🔐 <b>LANGKAH 2/2: Masukkan Secret Key Binance</b>\n\n` +
            `✅ API Key berhasil diterima!\n` +
            `Sekarang kirimkan (paste) <b>Secret Key</b> akun Binance Anda ke chat ini.\n\n` +
            `🔒 <i>Pesan Anda akan otomatis langsung dihapus oleh bot demi keamanan riwayat chat.</i>\n` +
            `💡 <i>Ketik /cancel untuk membatalkan.</i>`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        if (session.step === 'AWAITING_API_SECRET') {
          // Immediately delete user message containing API secret
          await ctx.deleteMessage().catch(() => {});
          const apiSecret = rawText.trim();
          const apiKey = session.apiKey || '';
          this.userSessionStates.delete(chatId);

          const waitMsg = await ctx.reply('⏳ <i>Memverifikasi API Key & Secret ke Binance...</i>', { parse_mode: 'HTML' });

          const testRes = await this.tradingClient.testCredentials(apiKey, apiSecret);
          await ctx.deleteMessage(waitMsg.message_id).catch(() => {});

          if (testRes.success) {
            this.userManager.setBinanceCredentials(chatId, apiKey, apiSecret, testRes.canTrade);
            const maskedKey = `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
            const statusMode = testRes.canTrade ? '🟢 Spot Trading Aktif (Bisa Cek Saldo & 1-Click Buy)' : '🟡 Read-Only (Hanya Cek Saldo)';

            await ctx.reply(
              `🎉 <b>AKUN BINANCE BERHASIL TERHUBUNG!</b> 🚀\n\n` +
              `🔑 API Key: <code>${maskedKey}</code>\n` +
              `⚡ Mode: <b>${statusMode}</b>\n\n` +
              `🔒 Kredensial telah diamankan dengan enkripsi standar militer <b>AES-256-GCM</b>.\n\n` +
              `Buka menu <b>💼 Akun Binance</b> untuk melihat profil dan portofolio Anda!`,
              {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('💼 Buka Akun Binance & Saldo', 'binance:hub')]
                ])
              }
            );
          } else {
            await ctx.reply(
              `❌ <b>VERIFIKASI AKUN GAGAL!</b>\n\n` +
              `Binance menolak kredensial tersebut:\n` +
              `<i>${escapeHtml(testRes.error || 'Invalid API-key, IP, or permissions')}</i>\n\n` +
              `💡 <i>Pastikan API Key & Secret disalin dengan benar tanpa spasi tambahan, dan izin Reading telah dicentang di Binance.</i>`,
              {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('🔄 Coba Hubungkan Lagi', 'binance:login')],
                  [Markup.button.callback('📖 Panduan API Key', 'binance:guide')],
                  [Markup.button.callback('« Kembali ke Akun Binance', 'binance:hub')]
                ])
              }
            );
          }
          return;
        }

        if (session.step === 'AWAITING_CUSTOM_BUY_AMOUNT' && session.buySymbol) {
          const buySymbol = session.buySymbol;
          this.userSessionStates.delete(chatId);

          const cleanedAmount = rawText.replace(/[^0-9.]/g, '');
          const usdtAmount = parseFloat(cleanedAmount);

          if (isNaN(usdtAmount) || usdtAmount < 5) {
            await ctx.reply('❌ Nominal tidak valid atau kurang dari minimal $5.00 USDT. Pembelian dibatalkan.');
            return;
          }

          const creds = this.userManager.getBinanceCredentials(chatId);
          if (!creds) {
            await ctx.reply('❌ Akun Binance belum terhubung.');
            return;
          }

          let currentPrice = 0;
          let freeUsdt = 0;
          try {
            if (this.handlers) {
              const scanRes = await this.handlers.onScanSymbol(buySymbol);
              currentPrice = scanRes.entryPrice;
            }
            const accInfo = await this.tradingClient.getAccountBalances(creds.apiKey, creds.apiSecret);
            const usdtItem = accInfo.balances.find(b => b.asset === 'USDT');
            freeUsdt = usdtItem ? usdtItem.free : 0;
          } catch {}

          const confirmMsg = formatBuyConfirmMessage(buySymbol, usdtAmount, currentPrice, freeUsdt);
          await ctx.reply(confirmMsg, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Ya, Eksekusi Beli', `buy_confirm:${buySymbol}:${usdtAmount}`),
                Markup.button.callback('❌ Batalkan', 'buy:cancel')
              ]
            ])
          });
          return;
        }
      }

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
      if (/^💼.*(binance|akun)/i.test(rawText) || rawText === '💼 Akun Binance' || rawText === '💼 Binance Account') {
        await handleBinanceHub(ctx);
        return;
      }
      if (/^💰.*(balance|saldo)/i.test(rawText) || rawText === '💰 Saldo Binance (/balance)') {
        await handleBinanceHub(ctx);
        return;
      }
      if (/^🔗.*(connect|akun)/i.test(rawText) || rawText === '🔗 Akun Binance (/connect)') {
        await handleBinanceHub(ctx);
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
      if (/^👑.*admin/i.test(rawText) || rawText === '👑 Admin Menu (/admin)') {
        await handleAdminMenu(ctx);
        return;
      }

      if (!rawText.startsWith('/')) {
        return next();
      }

      const parts = rawText.slice(1).split(/\s+/);
      const rawCmd = parts[0].toLowerCase().split('@')[0]; // handle @bot_username
      const tf = parts[1];

      // Direct routing for Binance Hub commands (prevents false ticker matching):
      if (['binance', 'account', 'connect', 'balance', 'portfolio', 'saldo'].includes(rawCmd)) {
        await handleBinanceHub(ctx);
        return;
      }
      if (['disconnect', 'logout'].includes(rawCmd)) {
        await handleDisconnect(ctx);
        return;
      }

      // Handle /unwatch_<coin> shortcut
      const unwatchMatch = rawCmd.match(/^unwatch_([a-z0-9]+)$/);
      if (unwatchMatch) {
        const coin = unwatchMatch[1].toUpperCase();
        const sym = coin.endsWith('USDT') ? coin : `${coin}USDT`;
        const chatId = ctx.chat?.id?.toString();
        if (this.watcherService && chatId) {
          this.watcherService.removeWatcher(sym, chatId);
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
          { command: 'binance', description: '💼 Akun Binance, portofolio & 1-Click Buy' },
          { command: 'watchers', description: '📋 Pantauan live trade aktif (TP/SL)' },
          { command: 'scan', description: '📊 Scan watchlist pair' },
          { command: 'status', description: '⚙️ Status operasional & scanner bot' },
          { command: 'admin', description: '👑 Menu admin & kelola user (khusus admin)' },
          { command: 'help', description: '📖 Panduan lengkap & risk management' }
        ]);
        logger.info('Telegram Bot native command menu registered successfully');
      } catch (cmdErr) {
        logger.warn(`Could not set Telegram commands: ${(cmdErr as Error).message}`);
      }

      // Start long-polling asynchronously without awaiting the infinite loop.
      // In Telegraf, bot.launch() only resolves when polling terminates.
      this.bot.launch({ dropPendingUpdates: true }).catch(err => {
        logger.error(`Telegram bot polling terminated: ${(err as Error).message}`);
        this.isRunning = false;
      });
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
    const destChatId = targetChatId || this.config.telegram.adminChatId;
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
   * Send Buy Signal notification (with Notice Me button!) to all approved users
   */
  public async sendBuySignalAlert(result: SignalResult): Promise<boolean> {
    const message = formatBuySignalMessage(result);
    const inlineKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔔 Notice Me (Pantau)', `notice:${result.symbol}:${result.timeframe}`),
        Markup.button.callback('🛒 Beli Spot', `buy:${result.symbol}`)
      ]
    ]);

    const approvedUsers = this.userManager.getApprovedUsers();
    if (approvedUsers.length === 0) {
      return this.sendAlert(message, this.config.telegram.adminChatId);
    }

    let successCount = 0;
    for (const user of approvedUsers) {
      try {
        await this.bot.telegram.sendMessage(user.id, message, {
          parse_mode: 'HTML',
          ...inlineKeyboard
        });
        successCount++;
      } catch (err: any) {
        logger.warn(`Failed to send BUY signal to user ${user.id}: ${err.message}`);
        if (err.description?.includes('bot was blocked') || err.message?.includes('blocked')) {
          this.userManager.blockUser(user.id);
        }
      }
    }

    return successCount > 0;
  }

  /**
   * Broadcast daily trading suggestions update to all approved users
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

    const approvedUsers = this.userManager.getApprovedUsers();
    if (approvedUsers.length === 0) {
      return this.sendAlert(text, this.config.telegram.adminChatId);
    }

    let successCount = 0;
    for (const user of approvedUsers) {
      try {
        if (inlineKeyboard) {
          await this.bot.telegram.sendMessage(user.id, text, {
            parse_mode: 'HTML',
            ...inlineKeyboard
          });
        } else {
          await this.bot.telegram.sendMessage(user.id, text, {
            parse_mode: 'HTML'
          });
        }
        successCount++;
      } catch (err: any) {
        logger.warn(`Failed to send Daily Trading update to user ${user.id}: ${err.message}`);
        if (err.description?.includes('bot was blocked') || err.message?.includes('blocked')) {
          this.userManager.blockUser(user.id);
        }
      }
    }

    return successCount > 0;
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
