import { SignalResult } from '../strategy/signal.js';
import { formatPrice } from '../risk/riskManager.js';
export { formatPrice } from '../risk/riskManager.js';

export interface BotStatusInfo {
  status: 'ONLINE' | 'SCANNING' | 'ERROR';
  exchange: string;
  symbolCount: number;
  timeframe: string;
  lastScanTime: string;
  nextScanTime: string;
  uptime: string;
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
  return `🤖 <b>BOT STATUS</b>

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

    const distTp1 = ((trade.takeProfit1 - currPrice) / currPrice * 100).toFixed(2);
    const distTp2 = ((trade.takeProfit2 - currPrice) / currPrice * 100).toFixed(2);
    const distSl = ((currPrice - trade.stopLoss) / currPrice * 100).toFixed(2);

    msg += `<b>${i + 1}. ${pair}</b> (${trade.timeframe}) — [${statusBadge}]\n`;
    msg += `💰 Entry: ${formatPrice(trade.entryPrice)} | Saat Ini: <b>${formatPrice(currPrice)}</b> (${pnlEmoji} ${pnlSign}${pnlPct.toFixed(2)}%)\n`;
    msg += `🎯 TP1: ${formatPrice(trade.takeProfit1)} (sisa +${distTp1}%)\n`;
    msg += `🎯 TP2: ${formatPrice(trade.takeProfit2)} (sisa +${distTp2}%)\n`;
    msg += `🛑 SL: ${formatPrice(trade.stopLoss)} (jarak -${distSl}%)\n`;
    msg += `👉 Hentikan: /unwatch_${trade.symbol.toLowerCase().replace('usdt', '')}\n\n`;
  }

  msg += `💡 <i>Bot terus memantau harga secara live dan akan mengirim notifikasi saat target tercapai.</i>`;
  return msg.trim();
}

/**
 * Formats /start message
 */
export function formatStartMessage(availableCommands: string[]): string {
  return `🤖 <b>Chaewon Crypto Signal Bot</b>

Bot analisa teknikal spot, scalping radar &amp; trade watcher otomatis dari Binance.

📌 <b>Perintah Tersedia:</b>
• /scalp [15m|30m] - <b>Radar Peluang Scalping</b> cepat timeframe pendek
• /screener atau /find - <b>Market Screener</b> 30 koin aktif di Binance
• /scan - Scan pair di daftar pantauan (Watchlist)
• /watchers - Lihat semua trade yang sedang dipantau live
• /analyze &lt;coin&gt; [tf] - Analisa koin apapun di Binance (contoh: <code>/analyze SUI</code> atau <code>/analyze SOL 1h</code>)
• /&lt;coin&gt; - Shortcut cepat analisa koin (contoh: /btc, /eth, /sol, /near, /sui, /doge)
• /status - Cek status operasional bot
• /help - Panduan lengkap &amp; risk management

🔔 <b>Fitur "Notice Me":</b>
Pada setiap analisa koin, klik tombol <b>🔔 Notice Me</b> untuk meminta bot menjadwalkan notifikasi otomatis saat Take Profit atau Stop Loss tersentuh!`;
}

/**
 * Formats /help message
 */
export function formatHelpMessage(): string {
  return `📖 <b>PANDUAN CHAEWON CRYPTO SIGNAL BOT</b>

<b>Perintah Utama:</b>
• /scalp [15m|30m] - Radar scalping cepat mencari momentum entry jangka pendek (15-30 menit).
• /screener atau /find - Scan 30 koin volume tertinggi di Binance, filter setup entry BUY &amp; WATCH.
• /watchers - Melihat daftar trade yang sedang dipantau bot.
• /unwatch &lt;koin&gt; - Membatalkan pemantauan trade.
• /analyze &lt;koin&gt; [tf] - Analisa koin apapun di Binance Spot (contoh: <code>/analyze DOGE</code> atau <code>/analyze SUI 4h</code>).
• /&lt;koin&gt; - Shortcut cepat: <code>/btc</code>, <code>/eth</code>, <code>/sol</code>, <code>/near</code>, <code>/sui</code>, dll.
• /status - Status bot &amp; jadwal scanning berkala.

<b>Fitur "Notice Me" (Pemantau Posisi Real-time):</b>
Saat Anda melihat hasil analisa koin (misal: <code>/near</code>), klik tombol <b>🔔 Notice Me</b> di bawah pesan.
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
