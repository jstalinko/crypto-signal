import { SignalResult } from '../strategy/signal.js';
import { formatPrice } from '../risk/riskManager.js';
import { BotUser } from '../user/userManager.js';
import { AccountBalanceInfo, OrderExecutionResult } from '../exchange/binanceTrade.js';
export { formatPrice } from '../risk/riskManager.js';

export interface BotStatusInfo {
  status: 'ONLINE' | 'SCANNING' | 'ERROR';
  exchange: string;
  symbolCount: number;
  timeframe: string;
  lastScanTime: string;
  nextScanTime: string;
  uptime: string;
  dailyTradingStatus?: string;
  nextDailyScanTime?: string;
}

/**
 * Escapes characters that are special in Telegram HTML parse mode.
 * Prevents 400 Bad Request: can't parse entities errors.
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format symbol nicely: BTCUSDT -> BTC/USDT
 */
export function formatSymbolDisplay(symbol: string): string {
  if (symbol.endsWith('USDT')) {
    return `${symbol.replace('USDT', '')}/USDT`;
  }
  if (symbol.endsWith('BUSD')) {
    return `${symbol.replace('BUSD', '')}/BUSD`;
  }
  if (symbol.endsWith('USDC')) {
    return `${symbol.replace('USDC', '')}/USDC`;
  }
  return symbol;
}

/**
 * Get Signal Emoji
 */
export function getSignalEmoji(signal: string): string {
  switch (signal) {
    case 'BUY':
      return '🟢';
    case 'WATCH':
      return '🟡';
    case 'SELL':
      return '🔴';
    case 'HOLD':
    default:
      return '⚪';
  }
}

/**
 * Formats a BUY Signal alert message for Telegram
 */
export function formatBuySignalMessage(result: SignalResult): string {
  const {
    symbol,
    entryPrice,
    stopLoss,
    takeProfit1,
    takeProfit2,
    score,
    indicators,
    timeframe
  } = result;
  const pairDisplay = formatSymbolDisplay(symbol);

  // EMA trend indicator display
  let emaDisplay = 'Bearish';
  if (indicators.emaFast > indicators.emaSlow && indicators.emaSlow > indicators.emaTrend) {
    emaDisplay = 'Bullish (EMA20 &gt; EMA50 &gt; EMA200)';
  } else if (indicators.emaFast > indicators.emaSlow) {
    emaDisplay = 'Mild Bullish (EMA20 &gt; EMA50)';
  }

  const macdDisplay =
    indicators.macd.macd > indicators.macd.signal && indicators.macd.histogram > 0
      ? 'Bullish'
      : 'Neutral';

  const slPct = ((entryPrice - stopLoss) / entryPrice * 100).toFixed(2);
  const tp1Pct = ((takeProfit1 - entryPrice) / entryPrice * 100).toFixed(2);
  const tp2Pct = ((takeProfit2 - entryPrice) / entryPrice * 100).toFixed(2);

  return `🟢 <b>BUY SIGNAL ALERT</b>

<b>${pairDisplay}</b>

💰 <b>Entry Price</b>
${formatPrice(entryPrice)}

🛑 <b>Stop Loss</b>
${formatPrice(stopLoss)} (-${slPct}%)

🎯 <b>Take Profit</b>
• TP1: ${formatPrice(takeProfit1)} (+${tp1Pct}%) [R:R 1:1.5]
• TP2: ${formatPrice(takeProfit2)} (+${tp2Pct}%) [R:R 1:2.5]

📊 <b>Technical Score:</b> ${score}/100

📈 <b>Key Indicators:</b>
• EMA Trend: ${emaDisplay}
• RSI (14): ${indicators.rsi.toFixed(1)}
• MACD: ${macdDisplay}
• Volume Surge: ${indicators.volume.ratio.toFixed(2)}x (Avg: ${indicators.volume.average.toFixed(0)})

⏱ <b>Timeframe:</b> ${timeframe}
⚖️ <b>Risk / Reward:</b> 1:1.5 / 1:2.5

⚠️ <i>Signal analisa teknikal otomatis — gunakan risk management bijak.</i>`;
}

/**
 * Formats detailed single pair analysis (e.g. /btc, /eth, /sol, /analyze <coin>)
 * Always provides actionable Entry, SL, and TP for any signal!
 */
export function formatSingleAnalysisMessage(result: SignalResult): string {
  const {
    symbol,
    signal,
    score,
    entryPrice,
    stopLoss,
    takeProfit1,
    takeProfit2,
    indicators,
    timeframe,
    scoreBreakdown
  } = result;

  const pairDisplay = formatSymbolDisplay(symbol);
  const emoji = getSignalEmoji(signal);

  const slPct = ((entryPrice - stopLoss) / entryPrice * 100).toFixed(2);
  const tp1Pct = ((takeProfit1 - entryPrice) / entryPrice * 100).toFixed(2);
  const tp2Pct = ((takeProfit2 - entryPrice) / entryPrice * 100).toFixed(2);

  let msg = `${emoji} <b>ANALISA TEKNIKAL: ${pairDisplay}</b>\n\n`;
  msg += `Signal: <b>${signal}</b>\n`;
  msg += `Score: <b>${score}/100</b>\n`;
  msg += `Harga Saat Ini: <b>${formatPrice(entryPrice)}</b>\n`;
  msg += `Timeframe: <b>${timeframe}</b>\n\n`;

  if (signal === 'BUY') {
    msg += `🟢 <b>RENCANA ENTRY SPOT (SETUP AKTIF)</b>\n`;
    msg += `💰 <b>Entry Price:</b> ${formatPrice(entryPrice)}\n`;
    msg += `🛑 <b>Stop Loss:</b> ${formatPrice(stopLoss)} (-${slPct}%)\n`;
    msg += `🎯 <b>Take Profit 1:</b> ${formatPrice(takeProfit1)} (+${tp1Pct}%) [R:R 1:1.5]\n`;
    msg += `🎯 <b>Take Profit 2:</b> ${formatPrice(takeProfit2)} (+${tp2Pct}%) [R:R 1:2.5]\n`;
    msg += `⚖️ <b>Risk / Reward:</b> 1:1.5 / 1:2.5\n\n`;
  } else if (signal === 'WATCH') {
    msg += `🟡 <b>STATUS: DALAM PANTAUAN (WATCHLIST)</b>\n`;
    msg += `<i>Setup potensial (Score ${score}/100), menunggu konfirmasi valid.</i>\n`;
    msg += `💰 <b>Acuan Entry:</b> ${formatPrice(entryPrice)}\n`;
    msg += `🛑 <b>Acuan Stop Loss:</b> ${formatPrice(stopLoss)} (-${slPct}%)\n`;
    msg += `🎯 <b>Target TP1:</b> ${formatPrice(takeProfit1)} (+${tp1Pct}%)\n`;
    msg += `🎯 <b>Target TP2:</b> ${formatPrice(takeProfit2)} (+${tp2Pct}%)\n`;
    msg += `⚖️ <b>Risk / Reward:</b> 1:1.5 / 1:2.5\n\n`;
  } else if (signal === 'SELL') {
    msg += `🔴 <b>STATUS: BEARISH / REKOMENDASI EXIT</b>\n`;
    msg += `⚠️ <i>Trend breakdown di bawah support. Amankan modal spot / hindari entry baru.</i>\n`;
    msg += `🧱 <b>Support Jebol:</b> ${formatPrice(indicators.support)}\n\n`;
  } else {
    // HOLD
    msg += `⚪ <b>STATUS: NETRAL / WAIT &amp; SEE</b>\n`;
    msg += `<i>Market konsolidasi. Acuan level penting untuk entry jika terjadi breakout:</i>\n`;
    msg += `🧱 <b>Support (SL level):</b> ${formatPrice(indicators.support)}\n`;
    msg += `🚧 <b>Resistance (Breakout):</b> ${formatPrice(indicators.resistance)}\n`;
    msg += `🎯 <b>Proyeksi TP Breakout:</b> ${formatPrice(takeProfit1)} (+${tp1Pct}%)\n\n`;
  }

  msg += `📈 <b>Indikator Teknikal:</b>\n`;
  msg += `• RSI (14): ${indicators.rsi.toFixed(1)} ${
    indicators.isOverbought ? '(Overbought)' : indicators.isOversold ? '(Oversold)' : ''
  }\n`;
  msg += `• EMA Trend: 20: ${formatPrice(indicators.emaFast)} | 50: ${formatPrice(indicators.emaSlow)} | 200: ${formatPrice(indicators.emaTrend)}\n`;
  msg += `• MACD: ${indicators.macd.macd.toFixed(2)} | Signal: ${indicators.macd.signal.toFixed(2)} | Hist: ${indicators.macd.histogram.toFixed(2)}\n`;
  msg += `• Volume Surge: ${indicators.volume.ratio.toFixed(2)}x (Avg: ${indicators.volume.average.toFixed(0)})\n`;
  msg += `• 20-Period Resistance: ${formatPrice(indicators.resistance)}\n`;
  msg += `• 20-Period Support: ${formatPrice(indicators.support)}\n\n`;

  msg += `🔍 <b>Score Breakdown:</b>\n`;
  msg += `• EMA Trend: ${scoreBreakdown.ema.score}/${scoreBreakdown.ema.max} (${escapeHtml(scoreBreakdown.ema.description)})\n`;
  msg += `• RSI: ${scoreBreakdown.rsi.score}/${scoreBreakdown.rsi.max} (${escapeHtml(scoreBreakdown.rsi.description)})\n`;
  msg += `• MACD: ${scoreBreakdown.macd.score}/${scoreBreakdown.macd.max} (${escapeHtml(scoreBreakdown.macd.description)})\n`;
  msg += `• Volume: ${scoreBreakdown.volume.score}/${scoreBreakdown.volume.max} (${escapeHtml(scoreBreakdown.volume.description)})\n`;
  msg += `• Breakout: ${scoreBreakdown.breakout.score}/${scoreBreakdown.breakout.max} (${escapeHtml(scoreBreakdown.breakout.description)})\n\n`;

  msg += `⚠️ <i>Signal analisa teknikal — gunakan money management bijak.</i>`;
  return msg;
}

/**
 * Formats the summary scan message for /scan (Watchlist)
 */
export function formatScanSummaryMessage(results: SignalResult[]): string {
  let message = `📊 <b>MARKET WATCHLIST SCAN</b>\n\n`;

  for (const item of results) {
    const pair = formatSymbolDisplay(item.symbol);
    const emoji = getSignalEmoji(item.signal);
    const slPct = ((item.entryPrice - item.stopLoss) / item.entryPrice * 100).toFixed(2);
    const tp1Pct = ((item.takeProfit1 - item.entryPrice) / item.entryPrice * 100).toFixed(2);

    message += `<b>${pair}</b> ${emoji} <b>${item.signal}</b> (${item.score}/100)\n`;
    message += `Harga: <b>${formatPrice(item.entryPrice)}</b>\n`;

    if (item.signal === 'BUY' || item.signal === 'WATCH') {
      message += `🛑 SL: ${formatPrice(item.stopLoss)} (-${slPct}%) | 🎯 TP1: ${formatPrice(item.takeProfit1)} (+${tp1Pct}%)\n`;
      message += `RSI: ${item.indicators.rsi.toFixed(1)} | Vol: ${item.indicators.volume.ratio.toFixed(2)}x\n`;
    } else {
      message += `Support: ${formatPrice(item.indicators.support)} | Resist: ${formatPrice(item.indicators.resistance)}\n`;
    }

    message += `\n`;
  }

  message += `💡 <i>Ketik /&lt;coin&gt; (contoh: /btc, /eth, /sol) untuk analisa lengkap &amp; TP2.</i>`;
  return message.trim();
}

/**
 * Formats Market Screener message for /screener or /find
 * Scans top Binance coins and presents actionable entries
 */
export function formatScreenerMessage(
  results: SignalResult[],
  totalScanned: number,
  timeframe: string
): string {
  const buySetups = results.filter(r => r.signal === 'BUY');
  const watchSetups = results.filter(r => r.signal === 'WATCH').slice(0, 8);

  let msg = `🔍 <b>MARKET ENTRY SCREENER (${timeframe.toUpperCase()})</b>\n`;
  msg += `Scanned: <b>${totalScanned} pair USDT teraktif</b> di Binance\n\n`;

  if (buySetups.length > 0) {
    msg += `🟢 <b>PELUANG ENTRY AKTIF (BUY SETUPS)</b>\n`;
    msg += `<i>Sinyal terkonfirmasi dengan score tinggi:</i>\n\n`;

    for (const item of buySetups) {
      const pair = formatSymbolDisplay(item.symbol);
      const slPct = ((item.entryPrice - item.stopLoss) / item.entryPrice * 100).toFixed(2);
      const tp1Pct = ((item.takeProfit1 - item.entryPrice) / item.entryPrice * 100).toFixed(2);
      const tp2Pct = ((item.takeProfit2 - item.entryPrice) / item.entryPrice * 100).toFixed(2);

      msg += `🟢 <b>${pair}</b> — Score: <b>${item.score}/100</b>\n`;
      msg += `💰 Entry: <b>${formatPrice(item.entryPrice)}</b>\n`;
      msg += `🛑 SL: <b>${formatPrice(item.stopLoss)}</b> (-${slPct}%)\n`;
      msg += `🎯 TP1: <b>${formatPrice(item.takeProfit1)}</b> (+${tp1Pct}%)\n`;
      msg += `🎯 TP2: <b>${formatPrice(item.takeProfit2)}</b> (+${tp2Pct}%)\n`;
      msg += `📊 RSI: ${item.indicators.rsi.toFixed(1)} | Vol: ${item.indicators.volume.ratio.toFixed(2)}x\n`;
      msg += `👉 Detail: /${item.symbol.toLowerCase().replace('usdt', '')}\n\n`;
    }
  } else {
    msg += `⚪ <i>Saat ini belum ada pair dengan sinyal BUY &gt;= 75 (kondisi market konsolidasi/koreksi).</i>\n\n`;
  }

  if (watchSetups.length > 0) {
    msg += `🟡 <b>TOP KANDIDAT WATCHLIST (TERDEKAT KE ENTRY)</b>\n`;
    msg += `<i>Score 60-74, bersiap jika ada konfirmasi breakout:</i>\n\n`;

    for (const item of watchSetups) {
      const pair = formatSymbolDisplay(item.symbol);
      const slPct = ((item.entryPrice - item.stopLoss) / item.entryPrice * 100).toFixed(2);
      const tp1Pct = ((item.takeProfit1 - item.entryPrice) / item.entryPrice * 100).toFixed(2);

      msg += `🟡 <b>${pair}</b> — Score: <b>${item.score}/100</b>\n`;
      msg += `💰 Harga: ${formatPrice(item.entryPrice)} | SL: ${formatPrice(item.stopLoss)} (-${slPct}%)\n`;
      msg += `🎯 Target TP: ${formatPrice(item.takeProfit1)} (+${tp1Pct}%)\n`;
      msg += `📊 RSI: ${item.indicators.rsi.toFixed(1)} | Vol: ${item.indicators.volume.ratio.toFixed(2)}x\n`;
      msg += `👉 Detail: /${item.symbol.toLowerCase().replace('usdt', '')}\n\n`;
    }
  }

  msg += `💡 <i>Ketik /analyze &lt;koin&gt; untuk cek koin apapun di Binance.</i>`;
  return msg.trim();
}

/**
 * Formats /status message
 */
export function formatBotStatusMessage(info: BotStatusInfo): string {
  let msg = `🤖 <b>BOT STATUS</b>

Status: <b>${info.status}</b>

Exchange: ${info.exchange}
Symbols Watchlist: ${info.symbolCount}
Timeframe: ${info.timeframe}

Last scan:
${info.lastScanTime}

Next scan:
${info.nextScanTime}

Uptime:
${info.uptime}`;

  if (info.dailyTradingStatus) {
    msg += `\n\nDaily Trading: <b>${info.dailyTradingStatus}</b>`;
    if (info.nextDailyScanTime) {
      msg += `\nNext Daily Scan: ${info.nextDailyScanTime}`;
    }
  }

  return msg;
}

/**
 * Formats Scalping Radar suggestions message for /scalp
 */
export function formatScalpingMessage(
  results: SignalResult[],
  totalScanned: number,
  timeframe: string
): string {
  let msg = `⚡ <b>SCALPING OPPORTUNITY RADAR (${timeframe.toUpperCase()})</b>\n`;
  msg += `Scanned: <b>${totalScanned} koin teraktif</b> di Binance Spot\n`;
  msg += `Target: <i>Fast momentum breakout (durasi 15-30 menit)</i>\n\n`;

  const topScalps = results.slice(0, 5);

  if (topScalps.length === 0) {
    msg += `⚪ <i>Tidak ada peluang scalping dengan momentum kuat saat ini. Coba periksa kembali beberapa saat lagi.</i>`;
    return msg;
  }

  for (let i = 0; i < topScalps.length; i++) {
    const item = topScalps[i];
    const pair = formatSymbolDisplay(item.symbol);
    const slPct = ((item.entryPrice - item.stopLoss) / item.entryPrice * 100).toFixed(2);
    const tp1Pct = ((item.takeProfit1 - item.entryPrice) / item.entryPrice * 100).toFixed(2);
    const tp2Pct = ((item.takeProfit2 - item.entryPrice) / item.entryPrice * 100).toFixed(2);

    msg += `<b>${i + 1}. ${pair}</b> — Score: <b>${item.score}/100</b> (${getSignalEmoji(item.signal)} ${item.signal})\n`;
    msg += `💰 Entry: <b>${formatPrice(item.entryPrice)}</b>\n`;
    msg += `🛑 Tight SL: <b>${formatPrice(item.stopLoss)}</b> (-${slPct}%)\n`;
    msg += `🎯 Scalp TP1: <b>${formatPrice(item.takeProfit1)}</b> (+${tp1Pct}%) [R:R 1:1.5]\n`;
    msg += `🎯 Scalp TP2: <b>${formatPrice(item.takeProfit2)}</b> (+${tp2Pct}%) [R:R 1:2.5]\n`;
    msg += `📊 RSI: ${item.indicators.rsi.toFixed(1)} | Vol: ${item.indicators.volume.ratio.toFixed(2)}x\n`;
    msg += `👉 Detail & Pantau: /${item.symbol.toLowerCase().replace('usdt', '')}\n\n`;
  }

  msg += `💡 <i>Ketik /&lt;koin&gt; lalu klik tombol <b>🔔 Notice Me</b> untuk memantau otomatis!</i>`;
  return msg.trim();
}

/**
 * Formats confirmation message when user clicks "Notice Me"
 */
export function formatWatcherConfirmationMessage(trade: {
  symbol: string;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  stopLossPercent: number;
  takeProfit1Percent: number;
  takeProfit2Percent: number;
}): string {
  const pair = formatSymbolDisplay(trade.symbol);

  return `🔔 <b>NOTICE ME DIAKTIFKAN: ${pair}</b>

Setup telah dijadwalkan ke pemantauan live bot:
💰 <b>Entry:</b> ${formatPrice(trade.entryPrice)}
🛑 <b>Stop Loss:</b> ${formatPrice(trade.stopLoss)} (-${trade.stopLossPercent.toFixed(2)}%)
🎯 <b>Take Profit 1:</b> ${formatPrice(trade.takeProfit1)} (+${trade.takeProfit1Percent.toFixed(2)}%)
🎯 <b>Take Profit 2:</b> ${formatPrice(trade.takeProfit2)} (+${trade.takeProfit2Percent.toFixed(2)}%)
⏱ <b>Timeframe:</b> ${trade.timeframe}

🤖 <b>Jadwal & Notifikasi Otomatis:</b>
Bot akan memantau harga real-time dan otomatis mengirim pesan ke chat ini saat:
• 🎯 <b>TP1 Tercapai</b> — Amankan 50% profit & geser SL ke BEP!
• 🚀 <b>TP2 Tercapai</b> — Profit maksimal tercapai & trade selesai.
• 🛑 <b>Stop Loss Tersentuh</b> — Peringatan cut loss disiplin.

Ketik /watchers untuk melihat semua pantauan aktif.`;
}

/**
 * Formats list of active watchers for /watchers
 */
export function formatWatchersListMessage(watchers: Array<{
  symbol: string;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  status: string;
  lastCheckedPrice?: number;
  lastCheckedAt?: number;
}>): string {
  if (watchers.length === 0) {
    return `📋 <b>DAFTAR PANTAUAN AKTIF (TRADE WATCHERS)</b>

<i>Saat ini tidak ada posisi yang sedang dipantau.</i>

💡 <b>Cara Mengaktifkan:</b>
Ketik analisa koin apa saja (contoh: /near, /sui, /sol) atau /scalp, lalu klik tombol <b>🔔 Notice Me</b> di bawah hasil analisa!`;
  }

  let msg = `📋 <b>DAFTAR PANTAUAN AKTIF (${watchers.length} POSISI)</b>\n\n`;

  for (let i = 0; i < watchers.length; i++) {
    const trade = watchers[i];
    const pair = formatSymbolDisplay(trade.symbol);
    const currPrice = trade.lastCheckedPrice || trade.entryPrice;
    const pnlPct = ((currPrice - trade.entryPrice) / trade.entryPrice * 100);
    const pnlSign = pnlPct >= 0 ? '+' : '';
    const pnlEmoji = pnlPct >= 0 ? '🟢' : '🔴';
    const statusBadge = trade.status === 'TP1_HIT' ? '🎯 TP1 HIT (BEP)' : '⚡ RUNNING';

    let tp1Text = '';
    if (currPrice >= trade.takeProfit1) {
      tp1Text = `🎯 TP1: ${formatPrice(trade.takeProfit1)} (✅ TERCAPAI)`;
    } else {
      const distTp1 = ((trade.takeProfit1 - currPrice) / currPrice * 100).toFixed(2);
      tp1Text = `🎯 TP1: ${formatPrice(trade.takeProfit1)} (sisa +${distTp1}%)`;
    }

    let tp2Text = '';
    if (currPrice >= trade.takeProfit2) {
      tp2Text = `🎯 TP2: ${formatPrice(trade.takeProfit2)} (✅ TERCAPAI)`;
    } else {
      const distTp2 = ((trade.takeProfit2 - currPrice) / currPrice * 100).toFixed(2);
      tp2Text = `🎯 TP2: ${formatPrice(trade.takeProfit2)} (sisa +${distTp2}%)`;
    }

    let slText = '';
    if (currPrice <= trade.stopLoss) {
      slText = `🛑 SL: ${formatPrice(trade.stopLoss)} (🛑 TERSENTUH)`;
    } else {
      const distSl = ((currPrice - trade.stopLoss) / currPrice * 100).toFixed(2);
      if (trade.status === 'TP1_HIT') {
        slText = `🛑 SL: ${formatPrice(trade.stopLoss)} (🛡 BEP Risk-Free | jarak -${distSl}%)`;
      } else {
        slText = `🛑 SL: ${formatPrice(trade.stopLoss)} (jarak -${distSl}%)`;
      }
    }

    let liveTag = '';
    if (trade.lastCheckedAt) {
      const secAgo = Math.max(0, Math.floor((Date.now() - trade.lastCheckedAt) / 1000));
      if (secAgo < 60) {
        liveTag = ` • <i>live (${secAgo}s lalu)</i>`;
      } else {
        const minAgo = Math.floor(secAgo / 60);
        liveTag = ` • <i>live (${minAgo}m lalu)</i>`;
      }
    }

    msg += `<b>${i + 1}. ${pair}</b> (${trade.timeframe}) — [${statusBadge}]\n`;
    msg += `💰 Entry: ${formatPrice(trade.entryPrice)} | Saat Ini: <b>${formatPrice(currPrice)}</b> (${pnlEmoji} ${pnlSign}${pnlPct.toFixed(2)}%${liveTag})\n`;
    msg += `${tp1Text}\n`;
    msg += `${tp2Text}\n`;
    msg += `${slText}\n`;
    msg += `👉 Hentikan: /unwatch_${trade.symbol.toLowerCase().replace('usdt', '')}\n\n`;
  }

  msg += `💡 <i>Bot terus memantau harga secara live (update tiap 15 detik) dan akan mengirim notifikasi saat target tercapai.</i>`;
  return msg.trim();
}

/**
 * Formats daily trading entry suggestions message
 */
export function formatDailyTradingMessage(
  results: SignalResult[],
  totalScanned: number,
  timeframe: string,
  isAutomatedUpdate: boolean = false
): string {
  const title = isAutomatedUpdate
    ? `📢 <b>UPDATE REKOMENDASI TRADING HARIAN (${timeframe.toUpperCase()})</b>`
    : `🎯 <b>REKOMENDASI ENTRY TRADING HARIAN (${timeframe.toUpperCase()})</b>`;

  let msg = `${title}\n`;
  msg += `Scanned: <b>${totalScanned} pair Binance Spot volume tertinggi</b>\n`;
  msg += `Fokus: <i>Day trading & swing momentum (Risk/Reward minimum 1:1.5)</i>\n\n`;

  if (results.length === 0) {
    msg += `⚪ <i>Saat ini belum ada setup dengan konfirmasi optimal (Score &gt;= 70). Pasar sedang bergerak sideways/koreksi.\nBot akan terus memantau dan mengirim update berkala saat setup entry muncul.</i>\n\n`;
    msg += `💡 <i>Gunakan menu <b>⚡ Scalp Radar</b> untuk momentum cepat atau <b>🔍 Screener</b> untuk pantauan koin lainnya.</i>`;
    return msg.trim();
  }

  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const pair = formatSymbolDisplay(item.symbol);
    const slPct = ((item.entryPrice - item.stopLoss) / item.entryPrice * 100).toFixed(2);
    const tp1Pct = ((item.takeProfit1 - item.entryPrice) / item.entryPrice * 100).toFixed(2);
    const tp2Pct = ((item.takeProfit2 - item.entryPrice) / item.entryPrice * 100).toFixed(2);

    let setupLabel = 'Bullish Setup';
    if (item.indicators.breakout) {
      setupLabel = '🚀 Breakout Resistance';
    } else if (item.indicators.emaFast > item.indicators.emaSlow && item.indicators.emaSlow > item.indicators.emaTrend) {
      setupLabel = '📈 Strong Bullish Trend (EMA Confluence)';
    } else if (item.indicators.rsi < 50 && item.indicators.rsi >= 35) {
      setupLabel = '🔄 Pullback Entry / Dip Buying';
    }

    msg += `<b>${i + 1}. ${pair}</b> — Score: <b>${item.score}/100</b> [${getSignalEmoji(item.signal)} ${item.signal}]\n`;
    msg += `🏷️ Setup: <i>${setupLabel}</i>\n`;
    msg += `💰 <b>Area Entry:</b> <b>${formatPrice(item.entryPrice)}</b>\n`;
    msg += `🛑 <b>Stop Loss:</b> ${formatPrice(item.stopLoss)} (-${slPct}%)\n`;
    msg += `🎯 <b>Target TP1 (50%):</b> ${formatPrice(item.takeProfit1)} (+${tp1Pct}%) [R:R 1:1.5]\n`;
    msg += `🚀 <b>Target TP2 (Max):</b> ${formatPrice(item.takeProfit2)} (+${tp2Pct}%) [R:R 1:2.5]\n`;
    msg += `📊 <b>Indikator:</b> RSI ${item.indicators.rsi.toFixed(1)} | Vol ${item.indicators.volume.ratio.toFixed(2)}x | MACD ${item.indicators.macd.histogram > 0 ? 'Bullish' : 'Neutral'}\n`;
    msg += `👉 Cek detail: /${item.symbol.toLowerCase().replace('usdt', '')}\n\n`;
  }

  msg += `💡 <i>Gunakan tombol menu keyboard di bawah untuk navigasi cepat atau klik <b>🔔 Notice Me</b> untuk pantau TP/SL otomatis!</i>`;
  return msg.trim();
}

/**
 * Formats /start message
 */
export function formatStartMessage(availableCoins: string[]): string {
  return `🤖 <b>Chaewon Crypto Signal Bot</b>

Bot analisa teknikal spot, scalping radar, rekomendasi trading harian &amp; trade watcher live otomatis dari Binance.

📱 <b>Menu Navigasi Cepat (Tombol Keyboard Tersedia di Bawah):</b>
• 🔍 <b>Screener (/find)</b> - Market Screener 30 koin aktif di Binance
• ⚡ <b>Scalp Radar (/scalp)</b> - Radar momentum scalping cepat (15m/30m)
• 🎯 <b>Daily Entry (/daily)</b> - Rekomendasi sinyal entry trading harian (1h)
• 📋 <b>Watchers (/watchers)</b> - Daftar live trade yang dipantau (TP/SL)
• 💼 <b>Akun Binance</b> - Portofolio saldo Spot &amp; 1-Click Order
• 📊 <b>Scan Watchlist (/scan)</b> - Scan koin di watchlist konfigurasi
• ℹ️ <b>Help &amp; Status (/help)</b> - Panduan lengkap &amp; status bot

📌 <b>Perintah Text / Slash:</b>
• /daily - Dapatkan rekomendasi entry trading harian
• /find atau /screener - Scan 30 koin volume tertinggi
• /scalp [15m|30m] - Radar scalping cepat
• /binance atau /account - Menu Akun Binance, profil &amp; saldo
• /watchers - Cek status posisi live yang sedang dipantau
• /analyze &lt;coin&gt; [tf] - Analisa koin apapun di Binance (contoh: <code>/analyze SUI</code> atau <code>/analyze SOL 1h</code>)
• /&lt;coin&gt; - Shortcut cepat analisa koin (contoh: /btc, /eth, /sol, /near, /sui, /doge)
• /menu - Tampilkan kembali menu tombol navigasi
• /status - Cek status operasional &amp; scan scheduler bot

🔔 <b>Fitur Otomatis &amp; Eksekusi:</b>
1. <b>Update Trading Harian:</b> Bot otomatis mengirim update peluang entry daily trading ke chat ini.
2. <b>Notice Me (Live TP/SL Alert):</b> Klik tombol <b>🔔 Notice Me</b> pada setiap sinyal untuk memantau harga secara live setiap 15 detik!
3. <b>1-Click Spot Buy:</b> Beli koin langsung dari Telegram begitu sinyal muncul hanya dengan 1 sentuhan!`;
}

/**
 * Formats /help message
 */
export function formatHelpMessage(): string {
  return `📖 <b>PANDUAN CHAEWON CRYPTO SIGNAL BOT</b>

<b>Navigasi Menu Utama:</b>
Gunakan keyboard tombol di bawah layar atau perintah slash berikut:
• /find atau /screener - Scan 30 koin volume tertinggi di Binance, filter setup entry BUY &amp; WATCH.
• /scalp [15m|30m] - Radar scalping cepat mencari momentum entry jangka pendek (15-30 menit).
• /daily - Dapatkan rekomendasi entry trading harian dengan level Entry, TP1, TP2, dan SL terperinci.
• /binance atau /account - Menu Akun Binance: cek portofolio live, hubungkan API Key, atau putuskan akun.
• /watchers - Melihat daftar trade yang sedang dipantau live oleh bot.
• /scan - Scan pair yang ada di daftar watchlist konfigurasi.
• /menu - Membuka menu navigasi tombol interaktif.
• /unwatch &lt;koin&gt; - Membatalkan pemantauan trade live.
• /analyze &lt;koin&gt; [tf] - Analisa koin apapun di Binance Spot (contoh: <code>/analyze DOGE</code> atau <code>/analyze SUI 4h</code>).
• /&lt;koin&gt; - Shortcut cepat: <code>/btc</code>, <code>/eth</code>, <code>/sol</code>, <code>/near</code>, <code>/sui</code>, dll.
• /status - Status bot &amp; jadwal scanning berkala.

<b>Fitur Rekomendasi Trading Harian:</b>
Bot secara otomatis menganalisa koin-koin berlikuiditas tinggi di Binance pada timeframe 1H dan mengirimkan update sinyal entry ke chat ini secara berkala. Anda juga dapat memicu analisa harian kapan saja dengan mengetik <code>/daily</code> atau menekan tombol <b>🎯 Daily Entry</b>.

<b>Fitur "Notice Me" (Pemantau Posisi Real-time):</b>
Saat Anda melihat hasil rekomendasi atau analisa koin (misal: <code>/near</code>), klik tombol <b>🔔 Notice Me</b> di bawah pesan.
Bot akan:
1. Menjadwalkan pemantauan harga live setiap 30 detik.
2. Mengirimkan notifikasi instan saat harga menyentuh:
   • 🎯 <b>TP1 (+%):</b> Mengingatkan Anda untuk ambil 50% profit &amp; geser SL ke BEP.
   • 🚀 <b>TP2 (+%):</b> Memberi tahu target maksimal telah tercapai.
   • 🛑 <b>Stop Loss (-%):</b> Mengingatkan disiplin cut loss untuk melindungi modal.

<b>Klasifikasi Sinyal:</b>
🟢 <b>BUY</b>: Score &gt;= 75 + Terpenuhi Konfirmasi Penuh (EMA20 &gt; EMA50 &gt; EMA200, Harga &gt; EMA20, MACD Bullish).
🟡 <b>WATCH</b>: Score 60-74, setup mendekati valid menunggu konfirmasi breakout.
⚪ <b>HOLD</b>: Market konsolidasi / netral, menunggu setup valid.
🔴 <b>SELL</b>: Trend breakdown, disarankan amankan modal spot.

<b>Risk Management &amp; TP/SL:</b>
• <b>Stop Loss (SL)</b>: Dihitung berbasis 1.5x ATR dari harga entry untuk memberi ruang volatilitas wajar.
• <b>Take Profit 1 (TP1)</b>: Risk/Reward 1:1.5 (Amankan sebagian profit &amp; pasang BEP).
• <b>Take Profit 2 (TP2)</b>: Risk/Reward 1:2.5 (Trailing stop untuk memaksimalkan profit).

⚠️ <i>Bot ini adalah alat bantu analisa teknikal spot dan bukan saran keuangan mutlak. Selalu gunakan stop loss dan money management bijak!</i>`;
}

/**
 * Formats notification for Admin when a new user joins
 */
export function formatNewUserRequestMessage(user: BotUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Tidak diketahui';
  const username = user.username ? `@${escapeHtml(user.username)}` : '<i>(Tidak ada)</i>';
  const dateStr = new Date(user.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  return `🔔 <b>PERMINTAAN AKSES PENGGUNA BARU</b>

👤 <b>Nama:</b> ${escapeHtml(name)}
🏷️ <b>Username:</b> ${username}
🆔 <b>Chat ID:</b> <code>${escapeHtml(user.id)}</code>
📅 <b>Waktu Daftar:</b> ${dateStr}

Silakan setujui atau tolak permintaan ini:`;
}

/**
 * Formats message shown to user when they are waiting for approval
 */
export function formatWaitingApprovalMessage(user: BotUser): string {
  const name = user.firstName ? escapeHtml(user.firstName) : 'Pengguna';
  return `⏳ <b>AKSES MENUNGGU PERSETUJUAN ADMIN</b>

Halo <b>${name}</b>, selamat datang di <b>Chaewon Crypto Signal</b>!

Bot ini saat ini berada dalam mode akses publik terkelola dan memerlukan persetujuan Admin sebelum dapat digunakan.

Permintaan akses Anda (Chat ID: <code>${escapeHtml(user.id)}</code>) telah dikirimkan ke Admin. Anda akan menerima notifikasi otomatis begitu akun Anda disetujui.`;
}

/**
 * Formats notification sent to user when approved
 */
export function formatUserApprovedNotification(): string {
  return `🎉 <b>SELAMAT! AKUN ANDA TELAH DISETUJUI!</b> 🟢

Akses Anda ke <b>Chaewon Crypto Signal Bot</b> telah diaktifkan oleh Admin.

Sekarang Anda dapat menggunakan seluruh fitur:
• 🔍 Market Screener Binance (30 koin aktif)
• ⚡ Scalp Radar momentum (15m / 30m)
• 🎯 Rekomendasi Daily Trading
• 🔔 Notice Me (Pemantau live TP/SL otomatis)
• 📊 Analisa koin kustom (contoh: /btc, /sol, /near)

Ketik /menu atau gunakan tombol keyboard di bawah untuk mulai!`;
}

/**
 * Formats notification sent to user when rejected
 */
export function formatUserRejectedNotification(): string {
  return `⚠️ <b>STATUS PERMINTAAN AKSES</b>

Mohon maaf, permintaan akses Anda ke bot ini belum dapat disetujui oleh Admin saat ini.`;
}

/**
 * Formats Admin Dashboard overview
 */
export function formatAdminDashboard(stats: {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  blocked: number;
}): string {
  return `👑 <b>CHAEWON SIGNAL — ADMIN DASHBOARD</b>

📊 <b>Ringkasan Pengguna:</b>
• 👥 Total Pengguna: <b>${stats.total}</b>
• ✅ Disetujui (Active): <b>${stats.approved}</b>
• ⏳ Menunggu (Pending): <b>${stats.pending}</b>
• ❌ Ditolak (Rejected): <b>${stats.rejected}</b>
• 🚫 Diblokir (Blocked): <b>${stats.blocked}</b>

⚙️ <i>Gunakan menu tombol di bawah untuk melihat daftar pengguna, meninjau persetujuan, atau broadcast pesan.</i>`;
}

/**
 * Formats users list for Admin view
 */
export function formatAdminUsersList(users: BotUser[]): string {
  if (users.length === 0) {
    return `👥 <b>DAFTAR PENGGUNA BOT</b>\n\n<i>Belum ada pengguna terdaftar di sistem.</i>`;
  }

  let text = `👥 <b>DAFTAR PENGGUNA BOT (${users.length})</b>\n\n`;

  const displayUsers = users.slice(0, 15);
  displayUsers.forEach((u, i) => {
    const statusEmoji =
      u.status === 'approved' ? '✅' :
      u.status === 'pending' ? '⏳' :
      u.status === 'rejected' ? '❌' : '🚫';
    const roleBadge = u.role === 'admin' ? '👑 [ADMIN]' : '';
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'User';
    const username = u.username ? `@${escapeHtml(u.username)}` : '-';

    text += `<b>${i + 1}. ${statusEmoji} ${escapeHtml(name)}</b> ${roleBadge}\n`;
    text += `   • ID: <code>${escapeHtml(u.id)}</code> | ${username}\n`;
    text += `   • Status: <b>${u.status.toUpperCase()}</b>\n\n`;
  });

  if (users.length > 15) {
    text += `<i>... dan ${users.length - 15} pengguna lainnya.</i>\n\n`;
  }

  text += `💡 <i>Ketik /approve &lt;ID&gt; atau /reject &lt;ID&gt; untuk tindakan instan.</i>`;
  return text;
}

/**
 * Formats single user details for Admin view
 */
export function formatAdminUserDetail(user: BotUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Tidak diketahui';
  const username = user.username ? `@${escapeHtml(user.username)}` : '<i>(Tidak ada)</i>';
  const statusEmoji =
    user.status === 'approved' ? '✅' :
    user.status === 'pending' ? '⏳' :
    user.status === 'rejected' ? '❌' : '🚫';

  let text = `👤 <b>DETAIL PENGGUNA</b>\n\n`;
  text += `• <b>Nama:</b> ${escapeHtml(name)}\n`;
  text += `• <b>Username:</b> ${username}\n`;
  text += `• <b>Chat ID:</b> <code>${escapeHtml(user.id)}</code>\n`;
  text += `• <b>Peran (Role):</b> ${user.role === 'admin' ? '👑 Admin' : '👤 Regular User'}\n`;
  text += `• <b>Status:</b> ${statusEmoji} <b>${user.status.toUpperCase()}</b>\n`;
  text += `• <b>Waktu Daftar:</b> ${new Date(user.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n`;
  if (user.approvedAt) {
    text += `• <b>Waktu Disetujui:</b> ${new Date(user.approvedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n`;
  }
  if (user.lastActiveAt) {
    text += `• <b>Terakhir Aktif:</b> ${new Date(user.lastActiveAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n`;
  }

  return text;
}

/**
 * Formats Binance Spot Portfolio Balance message for /balance
 */
export function formatBinanceBalanceMessage(
  info: AccountBalanceInfo,
  maskedApiKey?: string
): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const d = new Date(info.updateTime || Date.now());
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} WIB`;

  let msg = `💰 <b>PORTOFOLIO SPOT BINANCE</b>\n\n`;

  const keyDisplay = maskedApiKey ? `<code>${escapeHtml(maskedApiKey)}</code>` : 'Terhubung';
  const tradeStatus = info.canTrade ? '🟢 Spot Trading Aktif' : '🟡 Read-Only';
  msg += `🔑 API Key: ${keyDisplay}\n`;
  msg += `⚡ Mode Akses: <b>${tradeStatus}</b>\n\n`;

  msg += `💵 <b>Total Estimasi Saldo:</b> <b>${formatPrice(info.totalEstimatedUsdt)}</b>\n`;
  msg += `<i>──────────────────────────────</i>\n\n`;

  if (info.balances.length === 0) {
    msg += `<i>Tidak ada saldo aset aktif di Spot Wallet (semua &lt; $0.10).</i>\n\n`;
  } else {
    msg += `📊 <b>Daftar Aset Aktif:</b>\n`;
    for (const b of info.balances) {
      const freeStr = b.free >= 1 ? b.free.toFixed(4) : b.free.toFixed(6);
      const estStr = b.estimatedUsdt > 0 ? ` (~${formatPrice(b.estimatedUsdt)})` : '';
      const lockedStr = b.locked > 0 ? ` <i>[🔒 ${b.locked.toFixed(4)}]</i>` : '';
      msg += `• <b>${b.asset}:</b> <code>${freeStr}</code>${estStr}${lockedStr}\n`;
    }
    msg += `\n`;
  }

  msg += `⏱ <i>Diperbarui pada: ${timeStr}</i>`;
  return msg.trim();
}

/**
 * Formats guide and connection instructions for /connect
 */
export function formatConnectInstructionsMessage(
  hasConnected: boolean = false,
  maskedApiKey?: string
): string {
  if (hasConnected) {
    return `🔗 <b>STATUS KONEKSI BINANCE</b>

Akun Binance Anda saat ini <b>TERHUBUNG</b>:
🔑 API Key: <code>${escapeHtml(maskedApiKey || '****')}</code>
🟢 Siap untuk cek portofolio (/balance) dan 1-Click Order.

💡 <b>Pilihan Tindakan:</b>
• Ketik /balance untuk cek saldo live.
• Ketik /disconnect jika ingin memutuskan sambungan akun.`;
  }

  return `🔗 <b>HUBUNGKAN AKUN BINANCE (API KEY)</b>

Hubungkan akun Binance Anda untuk mengaktifkan fitur <b>Cek Portofolio (/balance)</b> dan <b>1-Click Spot Buy</b> langsung dari bot!

📋 <b>Langkah Mudah Membuat API Key di Binance:</b>
1. Buka aplikasi / website Binance, masuk ke menu <b>Profile ➔ API Management</b>.
2. Klik <b>Create API</b> (pilih <i>System generated</i>).
3. Beri label, contoh: <code>SpotSignalBot</code>.
4. Pada bagian <b>API Restrictions</b>:
   ✅ Centang <b>Enable Reading</b> (untuk cek saldo)
   ✅ Centang <b>Enable Spot &amp; Margin Trading</b> (untuk beli koin via bot)
   ❌ <b>JANGAN CENTANG "Enable Withdrawals"</b> (demi keamanan dana Anda!)
5. Salin <b>API Key</b> dan <b>Secret Key</b> yang muncul.

🔒 <b>Keamanan Terjamin:</b>
• Kredensial dienkripsi dengan standar militer <b>AES-256-GCM</b>.
• Pesan yang Anda kirimkan berisi API Key akan <b>langsung dihapus otomatis</b> dari riwayat chat.
• Bot TIDAK MEMILIKI dan TIDAK MEMBUTUHKAN izin penarikan (Withdrawal).

👉 <b>Klik tombol di bawah atau ketik /connect untuk mulai!</b>`;
}

/**
 * Formats 1-Click Buy Confirmation Message
 */
export function formatBuyConfirmMessage(
  symbol: string,
  usdtAmount: number,
  currentPrice: number,
  freeUsdt: number
): string {
  const pair = formatSymbolDisplay(symbol);
  const estCoins = currentPrice > 0 ? (usdtAmount / currentPrice).toFixed(6) : '0';

  return `🛒 <b>KONFIRMASI PEMBELIAN SPOT</b>

Pair: <b>${pair}</b>
Tipe Order: <b>Market Order (Instant Fill)</b>
💰 Nominal Beli: <b>$${usdtAmount.toFixed(2)} USDT</b>
📈 Harga Pasar Saat Ini: <b>${formatPrice(currentPrice)}</b>
🪙 Estimasi Koin Didapat: ~<b>${estCoins} ${symbol.replace('USDT', '')}</b>

💵 Saldo USDT Anda: <b>$${freeUsdt.toFixed(2)} USDT</b>

⚠️ <i>Order akan langsung dieksekusi di akun Binance Spot Anda dengan harga pasar terbaik saat ini.</i>`;
}

/**
 * Formats order execution receipt
 */
export function formatOrderReceiptMessage(result: OrderExecutionResult): string {
  const pair = formatSymbolDisplay(result.symbol);
  const coin = result.symbol.replace('USDT', '');
  const d = new Date(result.transactTime || Date.now());
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} WIB`;

  return `🎉 <b>ORDER BELI SPOT BERHASIL!</b> 🚀

Pair: <b>${pair}</b>
Status: <b>${result.status} (FILLED)</b>
🆔 Order ID: <code>#${result.orderId}</code>

💰 Total USDT Dibelanjakan: <b>$${result.cummulativeQuoteQty.toFixed(2)} USDT</b>
🪙 Koin Didapat: <b>${result.executedQty} ${coin}</b>
📈 Rata-rata Harga Fill: <b>${formatPrice(result.avgPrice)}</b>

⏱ <i>Waktu Eksekusi: ${timeStr}</i>

💡 <i>Klik tombol di bawah untuk langsung memasang <b>Notice Me</b> agar bot memantau Take Profit &amp; Stop Loss untuk posisi ini!</i>`;
}

/**
 * Formats Binance Hub view when user is NOT logged in
 */
export function formatBinanceAccountNotLoggedInMessage(): string {
  return `💼 <b>AKUN BINANCE</b>

👤 <b>Status Akun:</b> ⚪ <b>Belum Terhubung</b>

Hubungkan akun Binance Anda untuk mengaktifkan:
• 💰 <b>Cek Portofolio &amp; Saldo Spot</b> real-time di Telegram
• 🛒 <b>1-Click Spot Buy</b> langsung dari sinyal rekomendasi bot
• 🔔 <b>Notice Me &amp; Trade Watcher</b> pantau target TP/SL otomatis

🔒 <b>Keamanan &amp; Privasi Terjamin:</b>
• Kredensial dienkripsi standar militer <b>AES-256-GCM</b> di disk lokal.
• Pesan teks API Key &amp; Secret yang Anda kirim akan <b>otomatis langsung dihapus</b> demi privasi.
• Cukup izin <i>Reading</i> &amp; <i>Spot Trading</i>. <b>JANGAN PERNAH aktifkan izin Penarikan (Withdrawals)!</b>

👉 <i>Silakan klik tombol di bawah untuk menghubungkan akun atau membaca panduan cara membuat API Key.</i>`;
}

/**
 * Formats Binance Hub view when user IS logged in (Profile & Portfolio)
 */
export function formatBinanceAccountLoggedInMessage(
  info: AccountBalanceInfo,
  maskedApiKey: string
): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const d = new Date(info.updateTime || Date.now());
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} WIB`;

  let msg = `💼 <b>PROFIL &amp; PORTOFOLIO AKUN BINANCE</b>\n\n`;

  const tradeStatus = info.canTrade ? '🟢 Spot Trading Aktif (Bisa Cek Saldo &amp; 1-Click Buy)' : '🟡 Read-Only (Hanya Cek Saldo)';
  msg += `👤 <b>Status Akun:</b> 🟢 <b>TERHUBUNG (Aktif)</b>\n`;
  msg += `🔑 <b>API Key:</b> <code>${escapeHtml(maskedApiKey)}</code>\n`;
  msg += `⚡ <b>Mode Akses:</b> <b>${tradeStatus}</b>\n\n`;

  msg += `💰 <b>PORTOFOLIO SPOT WALLET:</b>\n`;
  msg += `💵 <b>Total Estimasi Saldo:</b> <b>${formatPrice(info.totalEstimatedUsdt)}</b>\n`;
  msg += `<i>──────────────────────────────</i>\n\n`;

  if (info.balances.length === 0) {
    msg += `<i>Tidak ada saldo aset aktif di Spot Wallet (semua &lt; $0.10).</i>\n\n`;
  } else {
    msg += `📊 <b>Daftar Aset Aktif:</b>\n`;
    for (const b of info.balances) {
      const freeStr = b.free >= 1 ? b.free.toFixed(4) : b.free.toFixed(6);
      const estStr = b.estimatedUsdt > 0 ? ` (~${formatPrice(b.estimatedUsdt)})` : '';
      const lockedStr = b.locked > 0 ? ` <i>[🔒 ${b.locked.toFixed(4)}]</i>` : '';
      msg += `• <b>${b.asset}:</b> <code>${freeStr}</code>${estStr}${lockedStr}\n`;
    }
    msg += `\n`;
  }

  msg += `⏱ <i>Data live diperbarui: ${timeStr}</i>`;
  return msg.trim();
}

/**
 * Formats step-by-step Binance API Creation Guide
 */
export function formatBinanceApiGuideMessage(): string {
  return `📖 <b>PANDUAN MEMBUAT API KEY DI BINANCE</b>

Ikuti 5 langkah mudah berikut:
1. Buka aplikasi atau situs <b>Binance</b> (pastikan sudah login).
2. Pergi ke menu <b>Profile ➔ API Management</b>.
3. Klik <b>Create API</b>, pilih <i>System generated</i>, lalu beri nama label (contoh: <code>ChaewonBot</code>).
4. Lakukan verifikasi keamanan (2FA / Authenticator / Email).
5. Pada bagian <b>API Restrictions</b>:
   ✅ Centang <b>Enable Reading</b> (untuk melihat portofolio saldo)
   ✅ Centang <b>Enable Spot &amp; Margin Trading</b> (untuk beli koin via 1-Click Buy)
   ❌ <b>JANGAN CENTANG "Enable Withdrawals"</b> (demi keamanan dana Anda!)
6. Salin <b>API Key</b> dan <b>Secret Key</b> yang muncul.

🔒 <b>Jaminan Keamanan Bot:</b>
• Kredensial Anda dienkripsi lokal dengan standar <b>AES-256-GCM</b>.
• Pesan yang Anda kirim di chat Telegram akan <b>langsung dihapus secara otomatis</b>.
• Bot TIDAK DAPAT dan TIDAK AKAN PERNAH menarik dana Anda.`;
}


