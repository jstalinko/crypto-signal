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
  formatSellConfirmMessage,
  formatSellSelectMenuMessage,
  formatPortfolioSellSelectMessage,
  formatOrderReceiptMessage,
  formatBinanceAccountNotLoggedInMessage,
  formatBinanceAccountLoggedInMessage,
  formatBinanceApiGuideMessage,
  formatPnlReportMessage
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
  'pnl',
  'profit',
  'rekap',
  'history',
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
  'cancel',
  'buy',
  'beli',
  'sell',
  'jual'
]);

export interface UserSessionState {
  step: 'AWAITING_API_KEY' | 'AWAITING_API_SECRET' | 'AWAITING_CUSTOM_BUY_AMOUNT' | 'AWAITING_CUSTOM_SELL_AMOUNT';
  apiKey?: string;
  buySymbol?: string;
  sellSymbol?: string;
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
    this.tradingClient = new BinanceTradingClient(config.exchange.baseUrl, config.exchange.fallbackBaseUrl);
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
   * Main persistent reply keyboard with core shortcuts (simplified without parentheses)
   */
  public getMainReplyKeyboard(isAdmin: boolean = false) {
    const buttons = [
      ['🔍 Screener', '⚡ Scalp Radar'],
      ['🎯 Daily Entry', '📋 Watchers'],
      ['💼 Akun Binance', '📈 Rekap PnL'],
      ['📊 Scan Watchlist', 'ℹ️ Help & Status']
    ];

    if (isAdmin) {
      buttons.push(['👑 Admin Menu']);
    }

    return Markup.keyboard(buttons).resize();
  }

  /**
   * Main interactive inline keyboard for /menu
   */
  public getMainInlineKeyboard(isAdmin: boolean = false) {
    const buttons = [
      [
        Markup.button.callback('🔍 Screener', 'menu:find'),
        Markup.button.callback('⚡ Scalp Radar', 'menu:scalp')
      ],
      [
        Markup.button.callback('🎯 Daily Entry', 'menu:daily'),
        Markup.button.callback('📋 Watchers', 'menu:watchers')
      ],
      [
        Markup.button.callback('💼 Akun Binance', 'binance:hub'),
        Markup.button.callback('📈 Rekap PnL', 'menu:pnl')
      ],
      [
        Markup.button.callback('📊 Scan Watchlist', 'menu:scan'),
        Markup.button.callback('⚙️ Bot Status', 'menu:status')
      ],
      [
        Markup.button.callback('📖 Panduan & Help', 'menu:help')
      ]
    ];

    if (isAdmin) {
      buttons.push([
        Markup.button.callback('👑 Admin Panel', 'menu:admin')
      ]);
    }

    return Markup.inlineKeyboard(buttons);
  }

  /**
   * PnL report interactive inline keyboard
   */
  public getPnlInlineKeyboard(isAdmin: boolean = false, isGlobal: boolean = false) {
    const rows: any[] = [
      [
        Markup.button.callback('🔄 Refresh PnL', isGlobal ? 'pnl:refresh_global' : 'pnl:refresh'),
        Markup.button.callback('📋 Pantauan Aktif', 'menu:watchers')
      ]
    ];

    if (isAdmin) {
      rows.push([
        isGlobal
          ? Markup.button.callback('👤 PnL Akun Saya', 'pnl:personal')
          : Markup.button.callback('🌐 PnL Global (Semua User)', 'pnl:global'),
        Markup.button.callback('🗑️ Reset Histori', 'pnl:reset_confirm')
      ]);
    } else {
      rows.push([
        Markup.button.callback('🗑️ Reset Histori', 'pnl:reset_confirm')
      ]);
    }

    rows.push([
      Markup.button.callback('« Menu Utama', 'menu:main')
    ]);

    return Markup.inlineKeyboard(rows);
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
          `• 🔍 <b>Screener</b>: Scan 30 koin aktif di Binance\n` +
          `• ⚡ <b>Scalp Radar</b>: Momentum cepat timeframe 15m/30m\n` +
          `• 🎯 <b>Daily Entry</b>: Rekomendasi entry trading harian (1h)\n` +
          `• 📋 <b>Watchers</b>: Pantauan posisi live trade (TP/SL)\n` +
          `• 💼 <b>Akun Binance</b>: Cek portofolio saldo live &amp; 1-Click Buy\n` +
          `• 📈 <b>Rekap PnL</b>: Laporan akumulasi profit &amp; performa trade watcher\n` +
          `• 📊 <b>Scan Watchlist</b>: Scan pair koin di daftar pantauan\n` +
          `• ℹ️ <b>Help &amp; Status</b>: Info status bot &amp; panduan risiko`;

        if (isAdmin) {
          menuText += `\n• 👑 <b>Admin Panel</b>: Kelola pengguna &amp; persetujuan`;
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

    const handlePnl = async (ctx: any, isGlobal: boolean = false, editMessage: boolean = false) => {
      try {
        if (!this.watcherService) {
          await ctx.reply('ℹ️ Watcher service belum diaktifkan.');
          return;
        }

        const chatId = ctx.chat?.id?.toString() || '';
        const isAdmin = this.userManager.isAdmin(chatId);
        const targetChatId = (isAdmin && isGlobal) ? undefined : chatId;

        // Refresh live prices so unrealized floating PnL is completely up to date
        await this.watcherService.checkWatchers().catch(() => {});

        const summary = this.watcherService.generatePnlSummary(targetChatId);
        const text = formatPnlReportMessage(summary, {
          isGlobal: isAdmin && isGlobal,
          isAdmin
        });

        const keyboard = this.getPnlInlineKeyboard(isAdmin, isGlobal);

        if (editMessage && ctx.callbackQuery) {
          await ctx.editMessageText(text, {
            parse_mode: 'HTML',
            ...keyboard
          }).catch(() => ctx.reply(text, { parse_mode: 'HTML', ...keyboard }));
        } else {
          await this.replySafe(ctx, text, keyboard);
        }
      } catch (err) {
        logger.error(`Error handling /pnl: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal mengambil laporan PnL: ${escapeHtml((err as Error).message)}`);
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
              Markup.button.callback('💰 Jual Aset Spot', 'binance:sell_select')
            ],
            [
              Markup.button.callback('🔄 Ganti API Key', 'binance:relogin'),
              Markup.button.callback('❌ Putuskan Akun (Logout)', 'binance:logout')
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
    this.bot.command(['pnl', 'profit', 'rekap', 'history'], (ctx) => handlePnl(ctx));

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

        // Attach "Notice Me", "Beli Spot", and "Jual Spot" action buttons
        const inlineKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🔔 Notice Me (Pantau)', `notice:${result.symbol}:${result.timeframe}`)
          ],
          [
            Markup.button.callback('🛒 Beli Spot', `buy:${result.symbol}`),
            Markup.button.callback('💰 Jual Spot', `sell:${result.symbol}`)
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

    // 1-Click Buy & Sell Helpers
    const triggerBuyMenu = async (ctx: any, rawSymbol: string) => {
      let symbol = rawSymbol.toUpperCase();
      if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;
      const chatId = ctx.chat?.id?.toString() || '';

      const creds = this.userManager.getBinanceCredentials(chatId);
      if (!creds) {
        if (ctx.callbackQuery) await ctx.answerCbQuery('⚠️ Akun Binance belum terhubung.').catch(() => {});
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
        if (ctx.callbackQuery) await ctx.answerCbQuery('⚠️ Izin trading tidak aktif di API Key Anda.').catch(() => {});
        await ctx.reply(
          `⚠️ <b>IZIN TRADING TIDAK AKTIF</b>\n\n` +
          `API Key Anda saat ini dalam mode <i>Read-Only</i>. Pastikan Anda mencentang opsi <b>Enable Spot &amp; Margin Trading</b> pada menu API Management di Binance.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

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
    };

    const triggerBuyConfirm = async (ctx: any, rawSymbol: string, usdtAmount: number) => {
      let symbol = rawSymbol.toUpperCase();
      if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;
      const chatId = ctx.chat?.id?.toString() || '';

      if (isNaN(usdtAmount) || usdtAmount < 5) {
        await ctx.reply('❌ Nominal pembelian minimal $5.00 USDT.');
        return;
      }

      const creds = this.userManager.getBinanceCredentials(chatId);
      if (!creds) {
        await ctx.reply('❌ Akun Binance belum terhubung. Silakan hubungkan via /connect.');
        return;
      }

      let currentPrice = 0;
      let freeUsdt = 0;
      try {
        if (this.handlers) {
          const scanRes = await this.handlers.onScanSymbol(symbol);
          currentPrice = scanRes.entryPrice;
        }
        if (currentPrice <= 0) {
          const prices = await this.tradingClient.fetchTickerPrices();
          currentPrice = prices.get(symbol) || 0;
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
    };

    const triggerSellMenu = async (ctx: any, rawSymbol: string) => {
      let symbol = rawSymbol.toUpperCase();
      if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;
      const chatId = ctx.chat?.id?.toString() || '';

      const creds = this.userManager.getBinanceCredentials(chatId);
      if (!creds) {
        if (ctx.callbackQuery) await ctx.answerCbQuery('⚠️ Akun Binance belum terhubung.').catch(() => {});
        await ctx.reply(
          `⚠️ <b>AKUN BINANCE BELUM TERHUBUNG</b>\n\n` +
          `Untuk mengeksekusi penjualan Spot untuk <b>${formatSymbolDisplay(symbol)}</b>, silakan hubungkan API Key Binance Anda terlebih dahulu.`,
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
        if (ctx.callbackQuery) await ctx.answerCbQuery('⚠️ Izin trading tidak aktif di API Key Anda.').catch(() => {});
        await ctx.reply(
          `⚠️ <b>IZIN TRADING TIDAK AKTIF</b>\n\n` +
          `API Key Anda saat ini dalam mode <i>Read-Only</i>. Pastikan Anda mencentang opsi <b>Enable Spot &amp; Margin Trading</b> pada menu API Management di Binance.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

      const lotInfo = await this.tradingClient.getSymbolLotInfo(symbol);
      const baseAsset = lotInfo.baseAsset;

      let freeBase = 0;
      try {
        const accInfo = await this.tradingClient.getAccountBalances(creds.apiKey, creds.apiSecret);
        const baseItem = accInfo.balances.find(b => b.asset.toUpperCase() === baseAsset.toUpperCase());
        freeBase = baseItem ? baseItem.free : 0;
      } catch (fetchErr: any) {
        logger.warn(`Could not get balance for ${baseAsset}: ${fetchErr.message}`);
      }

      if (freeBase <= 0) {
        await ctx.reply(
          `❌ <b>SALDO TIDAK MENCUKUPI</b>\n\n` +
          `Anda tidak memiliki saldo <b>${baseAsset}</b> di Spot Wallet Binance (Saldo: <code>0 ${baseAsset}</code>).\n\n` +
          `💡 <i>Gunakan tombol di bawah untuk membeli koin ini terlebih dahulu.</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(`🛒 Beli Spot ${baseAsset}`, `buy:${symbol}`),
                Markup.button.callback('💼 Akun Binance', 'binance:hub')
              ]
            ])
          }
        );
        return;
      }

      let currentPrice = 0;
      try {
        if (this.handlers) {
          const scanRes = await this.handlers.onScanSymbol(symbol);
          currentPrice = scanRes.entryPrice;
        }
        if (currentPrice <= 0) {
          const prices = await this.tradingClient.fetchTickerPrices();
          currentPrice = prices.get(symbol) || 0;
        }
      } catch {
        const prices = await this.tradingClient.fetchTickerPrices();
        currentPrice = prices.get(symbol) || 0;
      }

      const totalValue = freeBase * currentPrice;

      if (totalValue > 0 && totalValue < lotInfo.minNotional) {
        await ctx.reply(
          `⚠️ <b>SALDO DI BAWAH MINIMUM ORDER (DUST)</b>\n\n` +
          `Saldo <b>${baseAsset}</b> Anda: <b>${freeBase} ${baseAsset}</b> (~<b>$${totalValue.toFixed(2)} USDT</b>).\n` +
          `Binance mewajibkan transaksi spot bernilai minimal <b>$${lotInfo.minNotional.toFixed(2)} USDT</b>.\n\n` +
          `💡 <i>Untuk saldo bernilai kecil (dust), Anda dapat menukarnya langsung ke BNB menggunakan fitur <b>Convert Small Balances to BNB</b> di aplikasi Binance.</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback(`🛒 Tambah Beli ${baseAsset}`, `buy:${symbol}`),
                Markup.button.callback('💼 Akun Binance', 'binance:hub')
              ]
            ])
          }
        );
        return;
      }

      const menuText = formatSellSelectMenuMessage(symbol, freeBase, currentPrice, lotInfo);

      await ctx.reply(menuText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('25%', `sell_pct:${symbol}:25`),
            Markup.button.callback('50%', `sell_pct:${symbol}:50`)
          ],
          [
            Markup.button.callback('75%', `sell_pct:${symbol}:75`),
            Markup.button.callback('100% (Semua)', `sell_pct:${symbol}:100`)
          ],
          [
            Markup.button.callback('✏️ Jumlah Kustom', `sell_amt:${symbol}:custom`),
            Markup.button.callback('❌ Batal', 'sell:cancel')
          ]
        ])
      });
    };

    const triggerSellConfirm = async (ctx: any, rawSymbol: string, param: string) => {
      let symbol = rawSymbol.toUpperCase();
      if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;
      const chatId = ctx.chat?.id?.toString() || '';

      const creds = this.userManager.getBinanceCredentials(chatId);
      if (!creds) {
        await ctx.reply('❌ Akun Binance belum terhubung. Silakan hubungkan via /connect.');
        return;
      }

      if (!creds.canTrade) {
        await ctx.reply(
          `⚠️ <b>IZIN TRADING TIDAK AKTIF</b>\n\n` +
          `API Key Anda saat ini dalam mode Read-Only. Aktifkan <b>Enable Spot &amp; Margin Trading</b> di Binance.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      const lotInfo = await this.tradingClient.getSymbolLotInfo(symbol);
      const baseAsset = lotInfo.baseAsset;

      let freeBase = 0;
      let currentPrice = 0;
      try {
        const accInfo = await this.tradingClient.getAccountBalances(creds.apiKey, creds.apiSecret);
        const baseItem = accInfo.balances.find(b => b.asset.toUpperCase() === baseAsset.toUpperCase());
        freeBase = baseItem ? baseItem.free : 0;

        if (this.handlers) {
          const scanRes = await this.handlers.onScanSymbol(symbol);
          currentPrice = scanRes.entryPrice;
        }
        if (currentPrice <= 0) {
          const prices = await this.tradingClient.fetchTickerPrices();
          currentPrice = prices.get(symbol) || 0;
        }
      } catch {
        const prices = await this.tradingClient.fetchTickerPrices();
        currentPrice = prices.get(symbol) || 0;
      }

      if (freeBase <= 0) {
        await ctx.reply(`❌ Anda tidak memiliki saldo <b>${baseAsset}</b> untuk dijual.`, { parse_mode: 'HTML' });
        return;
      }

      let rawQty = 0;
      let pctDisplay = 'Kustom';

      if (param.endsWith('%')) {
        const pctVal = parseFloat(param.replace('%', ''));
        if (isNaN(pctVal) || pctVal <= 0 || pctVal > 100) {
          await ctx.reply('❌ Persentase tidak valid (harus 1% - 100%).');
          return;
        }
        rawQty = (pctVal / 100) * freeBase;
        pctDisplay = `${pctVal}%`;
      } else {
        const cleaned = param.replace(/[^0-9.]/g, '');
        rawQty = parseFloat(cleaned);
        if (isNaN(rawQty) || rawQty <= 0) {
          await ctx.reply('❌ Jumlah koin tidak valid.');
          return;
        }
        if (rawQty > freeBase) {
          await ctx.reply(`❌ Jumlah melebihi saldo tersedia (${freeBase} ${baseAsset}).`);
          return;
        }
        pctDisplay = freeBase > 0 ? `${((rawQty / freeBase) * 100).toFixed(1)}%` : 'Kustom';
      }

      const formattedQtyStr = this.tradingClient.formatQuantityToStepSize(rawQty, lotInfo.stepSize);
      const sellQty = parseFloat(formattedQtyStr);

      if (sellQty <= 0 || sellQty < lotInfo.minQty) {
        await ctx.reply(`❌ Jumlah koin (${sellQty} ${baseAsset}) di bawah batas minimum Binance (${lotInfo.minQty} ${baseAsset}).`);
        return;
      }

      const estNotional = sellQty * currentPrice;
      if (estNotional < lotInfo.minNotional) {
        await ctx.reply(`❌ Nilai koin (~$${estNotional.toFixed(2)} USDT) di bawah batas minimum Binance ($${lotInfo.minNotional.toFixed(2)} USDT).`);
        return;
      }

      const confirmMsg = formatSellConfirmMessage(symbol, sellQty, pctDisplay, currentPrice, freeBase);
      await ctx.reply(confirmMsg, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Ya, Eksekusi Jual', `sell_confirm:${symbol}:${formattedQtyStr}`),
            Markup.button.callback('❌ Batalkan', 'sell:cancel')
          ]
        ])
      });
    };

    const handleBuyCommand = async (ctx: any) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const coin = parts[1];
      const usdtAmtStr = parts[2];

      if (!coin) {
        await this.replySafe(
          ctx,
          `⚠️ <b>Format Penggunaan:</b>\n<code>/buy &lt;koin&gt; [nominal_usdt]</code>\n\n` +
          `<b>Contoh:</b>\n` +
          `• <code>/buy SOL</code> (Buka menu pilih nominal beli)\n` +
          `• <code>/buy SOL 25</code> (Langsung konfirmasi beli $25 USDT)\n` +
          `• <code>/buy DOGE 50</code> (Langsung konfirmasi beli $50 USDT)`
        );
        return;
      }

      const sym = coin.toUpperCase().endsWith('USDT') ? coin.toUpperCase() : `${coin.toUpperCase()}USDT`;
      if (usdtAmtStr) {
        const amt = parseFloat(usdtAmtStr.replace(/[^0-9.]/g, ''));
        await triggerBuyConfirm(ctx, sym, amt);
      } else {
        await triggerBuyMenu(ctx, sym);
      }
    };

    const handleSellCommand = async (ctx: any) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const coin = parts[1];
      const param = parts[2];

      if (!coin) {
        const chatId = ctx.chat?.id?.toString() || '';
        const creds = this.userManager.getBinanceCredentials(chatId);
        if (!creds) {
          await this.replySafe(
            ctx,
            `⚠️ <b>Format Penggunaan:</b>\n<code>/sell &lt;koin&gt; [persentase|jumlah]</code>\n\n` +
            `<b>Contoh:</b>\n` +
            `• <code>/sell SOL</code> (Buka menu pilih % jual)\n` +
            `• <code>/sell SOL 50%</code> (Langsung konfirmasi jual 50%)\n` +
            `• <code>/sell SOL 1.5</code> (Langsung konfirmasi jual 1.5 SOL)\n\n` +
            `💡 <i>Hubungkan akun Binance via /binance untuk menjual koin.</i>`
          );
          return;
        }

        try {
          const accInfo = await this.tradingClient.getAccountBalances(creds.apiKey, creds.apiSecret);
          const stablecoins = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD']);
          const sellable = accInfo.balances.filter(b => !stablecoins.has(b.asset.toUpperCase()) && b.free > 0 && b.estimatedUsdt >= 4.5);

          if (sellable.length > 0) {
            const msgText = formatPortfolioSellSelectMessage(sellable);
            const buttons: any[] = [];
            let currentRow: any[] = [];
            for (const item of sellable) {
              const sym = `${item.asset}USDT`;
              currentRow.push(Markup.button.callback(`💰 Jual ${item.asset} ($${item.estimatedUsdt.toFixed(1)})`, `sell:${sym}`));
              if (currentRow.length === 2) {
                buttons.push(currentRow);
                currentRow = [];
              }
            }
            if (currentRow.length > 0) buttons.push(currentRow);
            buttons.push([Markup.button.callback('« Menu Utama', 'menu:main')]);
            await ctx.reply(msgText, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
            return;
          }
        } catch {}

        await this.replySafe(
          ctx,
          `⚠️ <b>Format Penggunaan:</b>\n<code>/sell &lt;koin&gt; [persentase|jumlah]</code>\n\n` +
          `<b>Contoh:</b>\n` +
          `• <code>/sell SOL</code>\n` +
          `• <code>/sell SOL 50%</code>\n` +
          `• <code>/sell SOL 1.5</code>`
        );
        return;
      }

      const sym = coin.toUpperCase().endsWith('USDT') ? coin.toUpperCase() : `${coin.toUpperCase()}USDT`;
      if (param) {
        await triggerSellConfirm(ctx, sym, param);
      } else {
        await triggerSellMenu(ctx, sym);
      }
    };

    this.bot.command(['buy', 'beli'], handleBuyCommand);
    this.bot.command(['sell', 'jual'], handleSellCommand);

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
    this.bot.action('menu:pnl', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handlePnl(ctx, false, true);
    });
    this.bot.action('pnl:refresh', async (ctx) => {
      await ctx.answerCbQuery('Memperbarui data PnL...').catch(() => {});
      await handlePnl(ctx, false, true);
    });
    this.bot.action('pnl:refresh_global', async (ctx) => {
      await ctx.answerCbQuery('Memperbarui data PnL global...').catch(() => {});
      await handlePnl(ctx, true, true);
    });
    this.bot.action('pnl:global', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handlePnl(ctx, true, true);
    });
    this.bot.action('pnl:personal', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await handlePnl(ctx, false, true);
    });
    this.bot.action('pnl:reset_confirm', async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const confirmText = `⚠️ <b>KONFIRMASI BERSIHKAN HISTORI PnL</b>\n\n` +
        `Apakah Anda yakin ingin menghapus seluruh riwayat trade watchers Anda?\n` +
        `Data performa &amp; win rate yang telah tercatat akan dibersihkan. Tindakan ini tidak dapat dibatalkan.`;
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🗑️ Ya, Hapus Seluruh Histori', 'pnl:reset_execute'),
          Markup.button.callback('❌ Batal', 'pnl:refresh')
        ]
      ]);
      await ctx.editMessageText(confirmText, { parse_mode: 'HTML', ...keyboard }).catch(() => {
        ctx.reply(confirmText, { parse_mode: 'HTML', ...keyboard });
      });
    });
    this.bot.action('pnl:reset_execute', async (ctx) => {
      const chatId = ctx.chat?.id?.toString() || '';
      if (this.watcherService) {
        this.watcherService.clearHistory(chatId);
      }
      await ctx.answerCbQuery('Histori PnL berhasil dibersihkan!').catch(() => {});
      await handlePnl(ctx, false, true);
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
      this.tradingClient.clearPriceCache();
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

    // 1-Click Spot Buy & Sell Actions
    this.bot.action(/^buy:([A-Z0-9]+)$/i, async (ctx) => {
      try {
        await triggerBuyMenu(ctx, ctx.match[1]);
      } catch (err) {
        logger.error(`Error in buy action: ${(err as Error).message}`);
        await ctx.answerCbQuery('❌ Gagal memproses order beli.').catch(() => {});
      }
    });

    this.bot.action(/^buy_amt:([A-Z0-9]+):([0-9.]+|custom)$/i, async (ctx) => {
      try {
        let symbol = ctx.match[1].toUpperCase();
        if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;
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
        await triggerBuyConfirm(ctx, symbol, usdtAmount);
      } catch (err) {
        logger.error(`Error in buy_amt action: ${(err as Error).message}`);
      }
    });

    this.bot.action(/^buy_confirm:([A-Z0-9]+):([0-9.]+)$/i, async (ctx) => {
      try {
        let symbol = ctx.match[1].toUpperCase();
        if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;
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
            [
              Markup.button.callback('🔔 Pasang Pantauan TP/SL (Notice Me)', `notice:${symbol}:15m`),
              Markup.button.callback('💰 Jual Spot Nanti', `sell:${symbol}`)
            ]
          ])
        });
      } catch (err) {
        logger.error(`Error executing buy order: ${(err as Error).message}`);
        await ctx.reply(`❌ <b>Eksekusi Order Beli Gagal!</b>\n\nAlasan: ${escapeHtml((err as Error).message)}`, { parse_mode: 'HTML' });
      }
    });

    this.bot.action('buy:cancel', async (ctx) => {
      await ctx.answerCbQuery('❌ Pembelian dibatalkan.').catch(() => {});
      await ctx.reply('❌ Pembelian spot telah dibatalkan.');
    });

    // 1-Click Spot Sell Actions
    this.bot.action(/^sell:([A-Z0-9]+)$/i, async (ctx) => {
      try {
        await triggerSellMenu(ctx, ctx.match[1]);
      } catch (err) {
        logger.error(`Error in sell action: ${(err as Error).message}`);
        await ctx.answerCbQuery('❌ Gagal memproses order jual.').catch(() => {});
      }
    });

    this.bot.action(/^sell_pct:([A-Z0-9]+):([0-9]+)$/i, async (ctx) => {
      try {
        let symbol = ctx.match[1].toUpperCase();
        if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;
        const pct = parseInt(ctx.match[2], 10);
        await ctx.answerCbQuery().catch(() => {});
        await triggerSellConfirm(ctx, symbol, `${pct}%`);
      } catch (err) {
        logger.error(`Error in sell_pct action: ${(err as Error).message}`);
      }
    });

    this.bot.action(/^sell_amt:([A-Z0-9]+):(custom|[0-9.]+)$/i, async (ctx) => {
      try {
        let symbol = ctx.match[1].toUpperCase();
        if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;
        const amtStr = ctx.match[2];
        const chatId = ctx.chat?.id?.toString() || '';

        await ctx.answerCbQuery().catch(() => {});

        if (amtStr === 'custom') {
          this.userSessionStates.set(chatId, {
            step: 'AWAITING_CUSTOM_SELL_AMOUNT',
            sellSymbol: symbol
          });

          const lotInfo = await this.tradingClient.getSymbolLotInfo(symbol);
          const baseAsset = lotInfo.baseAsset;
          const creds = this.userManager.getBinanceCredentials(chatId);
          let freeBase = 0;
          if (creds) {
            try {
              const accInfo = await this.tradingClient.getAccountBalances(creds.apiKey, creds.apiSecret);
              const baseItem = accInfo.balances.find(b => b.asset.toUpperCase() === baseAsset.toUpperCase());
              freeBase = baseItem ? baseItem.free : 0;
            } catch {}
          }

          await ctx.reply(
            `✏️ <b>Ketik jumlah ${baseAsset} yang ingin dijual:</b>\n\n` +
            `🪙 Saldo tersedia: <b>${freeBase} ${baseAsset}</b>\n\n` +
            `Contoh input:\n` +
            `• Angka koin: <code>0.5</code> atau <code>1.25</code>\n` +
            `• Persentase: <code>50%</code> atau <code>100%</code>\n\n` +
            `💡 <i>Ketik /cancel untuk membatalkan.</i>`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        await triggerSellConfirm(ctx, symbol, amtStr);
      } catch (err) {
        logger.error(`Error in sell_amt action: ${(err as Error).message}`);
      }
    });

    this.bot.action(/^sell_confirm:([A-Z0-9]+):([0-9.]+)$/i, async (ctx) => {
      try {
        let symbol = ctx.match[1].toUpperCase();
        if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;
        const sellQtyStr = ctx.match[2];
        const chatId = ctx.chat?.id?.toString() || '';

        await ctx.answerCbQuery('⏳ Mengeksekusi order jual di Binance...').catch(() => {});

        const creds = this.userManager.getBinanceCredentials(chatId);
        if (!creds) {
          await ctx.reply('❌ Kredensial Binance tidak ditemukan. Silakan hubungkan ulang via /connect.');
          return;
        }

        const lotInfo = await this.tradingClient.getSymbolLotInfo(symbol);
        const waitMsg = await ctx.reply(
          `⏳ <i>Mengirim Market Sell Order ${sellQtyStr} ${lotInfo.baseAsset} ke Binance Spot...</i>`,
          { parse_mode: 'HTML' }
        );

        const orderResult = await this.tradingClient.executeMarketSell(
          creds.apiKey,
          creds.apiSecret,
          symbol,
          sellQtyStr
        );

        await ctx.deleteMessage(waitMsg.message_id).catch(() => {});

        const receiptMsg = formatOrderReceiptMessage(orderResult);
        await ctx.reply(receiptMsg, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('💼 Cek Saldo Akun', 'binance:hub'),
              Markup.button.callback('« Menu Utama', 'menu:main')
            ]
          ])
        });
      } catch (err) {
        logger.error(`Error executing sell order: ${(err as Error).message}`);
        await ctx.reply(`❌ <b>Eksekusi Order Jual Gagal!</b>\n\nAlasan: ${escapeHtml((err as Error).message)}`, { parse_mode: 'HTML' });
      }
    });

    this.bot.action('sell:cancel', async (ctx) => {
      await ctx.answerCbQuery('❌ Penjualan dibatalkan.').catch(() => {});
      await ctx.reply('❌ Penjualan spot telah dibatalkan.');
    });

    this.bot.action('binance:sell_select', async (ctx) => {
      try {
        const chatId = ctx.chat?.id?.toString() || '';
        const creds = this.userManager.getBinanceCredentials(chatId);

        if (!creds) {
          await ctx.answerCbQuery('⚠️ Akun Binance belum terhubung.');
          return;
        }

        if (!creds.canTrade) {
          await ctx.answerCbQuery('⚠️ Izin trading belum aktif.');
          await ctx.reply(
            `⚠️ <b>IZIN TRADING TIDAK AKTIF</b>\n\n` +
            `API Key Anda saat ini dalam mode Read-Only. Aktifkan <b>Enable Spot &amp; Margin Trading</b> di Binance untuk dapat menjual aset.`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        await ctx.answerCbQuery().catch(() => {});

        const waitMsg = await ctx.reply('⏳ <i>Memeriksa saldo koin yang dapat dijual...</i>', { parse_mode: 'HTML' });

        const accInfo = await this.tradingClient.getAccountBalances(creds.apiKey, creds.apiSecret);
        await ctx.deleteMessage(waitMsg.message_id).catch(() => {});

        const stablecoins = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD']);
        const sellableAssets = accInfo.balances.filter(b =>
          !stablecoins.has(b.asset.toUpperCase()) &&
          b.free > 0 &&
          b.estimatedUsdt >= 4.5
        );

        if (sellableAssets.length === 0) {
          const smallAssets = accInfo.balances.filter(b =>
            !stablecoins.has(b.asset.toUpperCase()) &&
            b.free > 0 &&
            b.estimatedUsdt < 4.5 &&
            b.estimatedUsdt > 0.1
          );

          if (smallAssets.length > 0) {
            await ctx.reply(
              `⚠️ <b>TIDAK ADA ASET YANG MEMENUHI MINIMUM ORDER</b>\n\n` +
              `Anda memiliki aset koin di Spot Wallet, namun nilainya di bawah minimum order Binance ($5.00 USDT):\n` +
              smallAssets.map(a => `• <b>${a.asset}:</b> ${a.free} (~$${a.estimatedUsdt.toFixed(2)})`).join('\n') +
              `\n\n💡 <i>Gunakan fitur <b>Convert Small Balances to BNB</b> langsung di aplikasi Binance untuk menukar saldo kecil (dust).</i>`,
              {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('« Kembali ke Akun Binance', 'binance:hub')]
                ])
              }
            );
          } else {
            await ctx.reply(
              `ℹ️ <b>TIDAK ADA ASET SPOT UNTUK DIJUAL</b>\n\n` +
              `Spot Wallet Anda saat ini tidak memiliki saldo koin kripto selain stablecoin USDT/USDC.`,
              {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('« Kembali ke Akun Binance', 'binance:hub')]
                ])
              }
            );
          }
          return;
        }

        const msgText = formatPortfolioSellSelectMessage(sellableAssets);

        const buttons: any[] = [];
        let currentRow: any[] = [];

        for (const item of sellableAssets) {
          const sym = `${item.asset}USDT`;
          currentRow.push(
            Markup.button.callback(`💰 Jual ${item.asset} ($${item.estimatedUsdt.toFixed(1)})`, `sell:${sym}`)
          );
          if (currentRow.length === 2) {
            buttons.push(currentRow);
            currentRow = [];
          }
        }
        if (currentRow.length > 0) {
          buttons.push(currentRow);
        }

        buttons.push([Markup.button.callback('« Kembali ke Akun Binance', 'binance:hub')]);

        await ctx.reply(msgText, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (err) {
        logger.error(`Error in binance:sell_select: ${(err as Error).message}`);
        await ctx.reply(`❌ Gagal mengambil daftar aset: ${escapeHtml((err as Error).message)}`);
      }
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
          await triggerBuyConfirm(ctx, buySymbol, usdtAmount);
          return;
        }

        if (session.step === 'AWAITING_CUSTOM_SELL_AMOUNT' && session.sellSymbol) {
          const sellSymbol = session.sellSymbol;
          this.userSessionStates.delete(chatId);

          await triggerSellConfirm(ctx, sellSymbol, rawText.trim());
          return;
        }
      }

      // Check persistent Reply Keyboard button presses:
      if (/^🔍.*(screener|find)/i.test(rawText) || rawText === '🔍 Screener' || rawText === '🔍 Screener (/find)') {
        await handleScreener(ctx);
        return;
      }
      if (/^⚡.*scalp/i.test(rawText) || rawText === '⚡ Scalp Radar' || rawText === '⚡ Scalp Radar (/scalp)') {
        await handleScalp(ctx);
        return;
      }
      if (/^🎯.*(daily|entry)/i.test(rawText) || rawText === '🎯 Daily Entry' || rawText === '🎯 Daily Entry (/daily)') {
        await handleDaily(ctx);
        return;
      }
      if (/^📋.*watcher/i.test(rawText) || rawText === '📋 Watchers' || rawText === '📋 Watchers (/watchers)') {
        await handleWatchers(ctx);
        return;
      }
      if (/^💼.*(binance|akun)/i.test(rawText) || rawText === '💼 Akun Binance' || rawText === '💼 Binance Account') {
        await handleBinanceHub(ctx);
        return;
      }
      if (/^📈.*(pnl|profit|rekap|histori|performa)/i.test(rawText) || rawText === '📈 Rekap PnL') {
        await handlePnl(ctx);
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
      if (/^📊.*scan/i.test(rawText) || rawText === '📊 Scan Watchlist' || rawText === '📊 Scan Watchlist (/scan)') {
        await handleScan(ctx);
        return;
      }
      if (/^ℹ️.*(help|status)/i.test(rawText) || rawText === 'ℹ️ Help & Status' || rawText === 'ℹ️ Help & Status (/help)') {
        await handleHelp(ctx);
        return;
      }
      if (/^👑.*admin/i.test(rawText) || rawText === '👑 Admin Menu' || rawText === '👑 Admin Menu (/admin)') {
        await handleAdminMenu(ctx);
        return;
      }

      if (!rawText.startsWith('/')) {
        return next();
      }

      const parts = rawText.slice(1).split(/\s+/);
      const rawCmd = parts[0].toLowerCase().split('@')[0]; // handle @bot_username
      const tf = parts[1];

      // Direct routing for PnL commands:
      if (['pnl', 'profit', 'rekap', 'history'].includes(rawCmd)) {
        await handlePnl(ctx);
        return;
      }

      // Direct routing for Binance Hub commands (prevents false ticker matching):
      if (['binance', 'account', 'connect', 'balance', 'portfolio', 'saldo'].includes(rawCmd)) {
        await handleBinanceHub(ctx);
        return;
      }
      if (['disconnect', 'logout'].includes(rawCmd)) {
        await handleDisconnect(ctx);
        return;
      }
      if (['buy', 'beli'].includes(rawCmd)) {
        await handleBuyCommand(ctx);
        return;
      }
      if (['sell', 'jual'].includes(rawCmd)) {
        await handleSellCommand(ctx);
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
          { command: 'binance', description: '💼 Akun Binance, portofolio & Beli/Jual Spot' },
          { command: 'buy', description: '🛒 Beli spot koin langsung di Binance (/buy SOL)' },
          { command: 'sell', description: '💰 Jual spot koin langsung di Binance (/sell SOL)' },
          { command: 'watchers', description: '📋 Pantauan live trade aktif (TP/SL)' },
          { command: 'pnl', description: '📈 Rekap performa & histori PnL Watchers' },
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
        Markup.button.callback('🔔 Notice Me (Pantau)', `notice:${result.symbol}:${result.timeframe}`)
      ],
      [
        Markup.button.callback('🛒 Beli Spot', `buy:${result.symbol}`),
        Markup.button.callback('💰 Jual Spot', `sell:${result.symbol}`)
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
