# 🤖 Telegram Spot Trading Signal Bot

Bot sinyal trading spot cryptocurrency otomatis berbasis **Node.js**, **TypeScript**, dan **Telegraf**. Bot ini menganalisis pergerakan market spot dari Binance REST API publik secara real-time, mengevaluasi indikator teknikal (EMA, RSI, MACD, ATR, Volume Surge, Breakout), dan mengirimkan sinyal trading terkonfirmasi ke Telegram.

> ⚠️ **Catatan Penting:** Bot ini murni **Spot Trading Signal Bot** (tanpa auto-trading, tanpa leverage, tanpa futures, tanpa short position). Sinyal SELL adalah rekomendasi exit/take profit dari posisi spot.

---

## 📋 Daftar Isi

1. [Fitur Utama](#-fitur-utama)
2. [Persyaratan Sistem (Requirements)](#-persyaratan-sistem-requirements)
3. [Instalasi](#-instalasi)
4. [Konfigurasi (`config.json`)](#-konfigurasi-configjson)
5. [Cara Mendapatkan Telegram Bot Token](#-cara-mendapatkan-telegram-bot-token)
6. [Cara Mendapatkan Telegram Chat ID](#-cara-mendapatkan-telegram-chat-id)
7. [Menjalankan Bot (Development & Build)](#-menjalankan-bot)
8. [Panduan Production di VPS (PM2 / Systemd)](#-panduan-production-di-vps)
9. [Daftar Telegram Commands](#-daftar-telegram-commands)
10. [Logika Scoring & Klasifikasi Sinyal](#-logika-scoring--klasifikasi-sinyal)
11. [Risk Management (Stop Loss & Take Profit)](#-risk-management)
12. [Struktur Proyek](#-struktur-proyek)
13. [Disclaimer](#-disclaimer)

---

## 🚀 Fitur Utama

- **No-Repainting Candle Analysis**: Bot hanya menganalisis candle yang sudah **closed/final**.
- **Public REST API**: Tidak memerlukan API Key trading exchange atau secret keys.
- **Resilient Connectivity**: Otomatis fallback bila koneksi utama terhambat sensor ISP (misal DNS blocking Telkomsel ke `data-api.binance.vision`).
- **Scoring System (0–100)**: Evaluasi multi-faktor dari EMA trend, RSI, MACD, Volume ratio, dan Price Breakout.
- **False Positive Filter**: Mengharuskan konfirmasi minimum (EMA20 > EMA50, Harga > EMA20, MACD bullish) sebelum menghasilkan status `BUY`.
- **Anti-Spam & Cooldown**: Mencegah pengiriman sinyal berulang ke Telegram jika state masih sama dalam rentang cooldown (`cooldownMinutes`).
- **Chat ID Security**: Membatasi penggunaan perintah Telegram bot hanya untuk Chat ID yang diizinkan di `config.json`.
- **Token Masking**: Token bot tidak akan pernah bocor ke log console.

---

## 💻 Persyaratan Sistem (Requirements)

- **Node.js**: v18.0.0 atau lebih baru (direkomendasikan v20 LTS)
- **npm**: v9.0.0 atau lebih baru
- Akun Telegram aktif

---

## 📦 Instalasi

1. Clone repositori ke mesin lokal atau VPS Anda:
   ```bash
   git clone <repository_url>
   cd ChaeCryptosSignal
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

---

## ⚙️ Konfigurasi (`config.json`)

Salin file contoh konfigurasi:
```bash
cp config.example.json config.json
```

Buka dan sesuaikan nilai di `config.json`:
```json
{
  "telegram": {
    "token": "YOUR_TELEGRAM_BOT_TOKEN",
    "chatId": "YOUR_CHAT_ID",
    "cooldownMinutes": 30
  },
  "exchange": {
    "baseUrl": "https://api.binance.com",
    "fallbackBaseUrl": "https://data-api.binance.vision"
  },
  "trading": {
    "symbols": [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT"
    ],
    "timeframe": "15m",
    "candleLimit": 250,
    "scanIntervalSeconds": 60
  },
  "strategy": {
    "emaFast": 20,
    "emaSlow": 50,
    "emaTrend": 200,
    "rsiPeriod": 14,
    "atrPeriod": 14,
    "volumePeriod": 20,
    "buyThreshold": 75
  },
  "dailyTrading": {
    "enabled": true,
    "timeframe": "1h",
    "intervalHours": 4,
    "minScore": 70,
    "limit": 3
  }
}
```

> 🔒 **Keamanan:** File `config.json` sudah dimasukkan ke `.gitignore` sehingga tidak akan ter-commit ke Git repository publik.

---

## 🔑 Cara Mendapatkan Telegram Bot Token

1. Buka aplikasi Telegram dan cari **[@BotFather](https://t.me/BotFather)**.
2. Kirim pesan `/newbot`.
3. Masukkan nama bot Anda (contoh: `My Spot Signal Bot`).
4. Masukkan username bot yang diakhiri kata `bot` (contoh: `my_spot_signal_bot`).
5. BotFather akan memberikan **HTTP API Token** (contoh: `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`).
6. Masukkan token tersebut ke kolom `"token"` di `config.json`.

---

## 🆔 Cara Mendapatkan Telegram Chat ID

1. Cari bot **[@userinfobot](https://t.me/userinfobot)** atau **[@RawDataBot](https://t.me/RawDataBot)** di Telegram.
2. Klik `/start`. Bot akan menampilkan `Id` akun Telegram Anda (contoh: `123456789`).
3. Jika ingin mengirim ke grup/channel:
   - Tambahkan bot Anda ke grup/channel sebagai Admin.
   - Forward salah satu pesan dari grup ke `@RawDataBot` untuk mengetahui Chat ID grup (biasanya diawali tanda `-` atau `-100`).
4. Masukkan Chat ID tersebut ke kolom `"chatId"` di `config.json`.
5. Buka chat dengan bot Anda dan klik `/start` agar bot memiliki izin mengirim pesan ke Anda.

---

## 🏃 Menjalankan Bot

### Mode Development (Hot Reload / TSX)
```bash
npm run dev
```

### Build TypeScript
Mengompilasi file TypeScript dari direktori `src/` ke JavaScript di direktori `dist/`:
```bash
npm run build
```

### Menjalankan Production Build
```bash
npm start
```

---

## ☁️ Panduan Production di VPS

### Menggunakan PM2 (Process Manager)

1. Install PM2 secara global di VPS:
   ```bash
   npm install -g pm2
   ```

2. Build TypeScript project:
   ```bash
   npm run build
   ```

3. Jalankan aplikasi menggunakan PM2:
   ```bash
   pm2 start dist/index.js --name "spot-signal-bot"
   ```

4. Cek status dan log:
   ```bash
   pm2 status
   pm2 logs spot-signal-bot
   ```

5. Simpan process list agar otomatis berjalan saat VPS restart:
   ```bash
   pm2 save
   pm2 startup
   ```

---

## 📱 Navigasi Menu Keyboard & Tombol Utama

Bot ini dilengkapi dengan **Reply Keyboard navigasi persisten** yang selalu tersedia di bagian bawah layar Telegram serta tombol **Menu bawaan Telegram**:

- `🔍 Screener (/find)`: Memindai 30 koin aktif Binance untuk setup entry teratas.
- `⚡ Scalp Radar (/scalp)`: Radar momentum scalping cepat (15m/30m).
- `🎯 Daily Entry (/daily)`: Rekomendasi entry trading harian dengan kalkulasi level Entry, TP1, TP2, dan SL terperinci.
- `📋 Watchers (/watchers)`: Memantau live trade yang sedang dilacak dengan target TP/SL.
- `📊 Scan Watchlist (/scan)`: Memindai koin yang terdaftar di watchlist `config.json`.
- `ℹ️ Help & Status (/help)`: Panduan lengkap dan status scanner bot.

Anda dapat menekan tombol keyboard kapan saja atau menggunakan perintah slash berikut.

---

## 💬 Daftar Telegram Commands

| Perintah | Deskripsi |
|---|---|
| `/menu` | **Main Menu**: Membuka tampilan menu navigasi interaktif |
| `/find` atau `/screener` | **Market Screener**: Scan 30 koin volume tertinggi di Binance Spot untuk menemukan setup peluang entry BUY & WATCH teratas lengkap dengan TP & SL |
| `/scalp [15m\|30m]` | **Scalp Radar**: Memindai peluang momentum cepat durasi pendek (15-30 menit) |
| `/daily` atau `/suggestion` | **Rekomendasi Trading Harian**: Analisa timeframe 1H untuk setup day trading dengan R:R optimal (otomatis dikirim berkala oleh bot) |
| `/watchers` atau `/active` | **Trade Watchers**: Melihat daftar posisi live yang sedang dipantau real-time oleh bot |
| `/unwatch <koin>` | Membatalkan pemantauan live untuk koin tertentu (contoh: `/unwatch NEAR`) |
| `/scan` | Scan pair di daftar pantauan (`config.json`) |
| `/scan all` | Shortcut untuk menjalankan market screener ke top koin Binance |
| `/analyze <koin> [tf]` | **Analisa koin apapun di Binance Spot** (contoh: `/analyze SUI`, `/analyze DOGE 1h`, `/analyze SOL 15m`). Alias: `/entry`, `/cek` |
| `/<koin> [tf]` | **Shortcut cepat koin apapun** (contoh: `/sol`, `/eth`, `/btc`, `/doge`, `/pepe`, `/near`, `/xrp`, `/sui 1h`) |
| `/status` | Melihat status uptime, exchange, scheduler scan, dan interval daily trading |
| `/help` | Menampilkan panduan dan penjelasan indikator |

*(Catatan: Anda dapat mengetikkan koin apapun langsung dengan tanda slash, misalnya `/doge` atau `/pepe`, tanpa perlu mendaftarkannya terlebih dahulu di `config.json`)*.

---

## 📊 Logika Scoring & Klasifikasi Sinyal

Bot menggunakan sistem pembobotan 0 hingga 100:

| Komponen | Bobot Maksimal | Kondisi & Poin |
|---|---|---|
| **EMA Trend** | +25 | • EMA20 > EMA50 > EMA200: **+25**<br>• EMA20 > EMA50: **+15**<br>• EMA20 <= EMA50: **0** |
| **RSI (14)** | +15 | • 50 <= RSI <= 65 (Bullish ideal): **+15**<br>• 65 < RSI <= 70: **+10**<br>• 40 <= RSI < 50: **+5**<br>• RSI > 70 (Overbought): **0**<br>• RSI < 30 (Oversold): **0** |
| **MACD (12, 26, 9)** | +20 | • MACD > Signal & Histogram > 0: **+20**<br>• MACD > Signal & Histogram <= 0: **+10**<br>• MACD <= Signal: **0** |
| **Volume Surge** | +20 | • Volume Ratio >= 1.5x: **+20**<br>• Volume Ratio >= 1.2x: **+10**<br>• Volume Ratio < 1.2x: **0** |
| **Price Breakout** | +20 | • Close > Resistance 20-candle: **+20**<br>• Close menguji level Resistance: **+10**<br>• Di bawah Resistance: **0** |

### Klasifikasi Sinyal:
- **🟢 BUY**: Skor >= 75 **DAN** memenuhi *Minimum Confirmation*:
  1. `EMA20 > EMA50`
  2. `Close Price > EMA20`
  3. `MACD Bullish` (MACD Line > Signal Line & Histogram > 0)
- **🟡 WATCH**: Skor 60 - 74, atau Skor >= 75 tetapi belum lolos konfirmasi minimum (mengurangi risiko false breakout).
- **⚪ HOLD**: Skor < 60 (market bergerak menyamping/konsolidasi).
- **🔴 SELL**: Terjadi pelemahan signifikan / bearish breakdown (EMA20 < EMA50, Harga < EMA20, MACD bearish, dan breakdown support). Rekomendasi exit spot.

---

## ⚖️ Risk Management

Level Stop Loss dan Take Profit dihitung otomatis berbasis **Average True Range (ATR 14)** untuk menyesuaikan volatilitas:

- **Entry**: Harga penutupan candle terakhir yang sudah close.
- **Stop Loss (SL)**:
  $$\text{SL} = \text{Entry} - (\text{ATR} \times 1.5)$$
- **Take Profit 1 (TP1)** (Risk/Reward 1 : 1.5):
  $$\text{TP1} = \text{Entry} + (\text{Risk} \times 1.5)$$
- **Take Profit 2 (TP2)** (Risk/Reward 1 : 2.5):
  $$\text{TP2} = \text{Entry} + (\text{Risk} \times 2.5)$$

---

## 📁 Struktur Proyek

```text
ChaeCryptosSignal/
├── src/
│   ├── index.ts                # Application entrypoint & graceful shutdown
│   ├── config.ts               # Configuration loader & validation
│   │
│   ├── exchange/
│   │   └── binance.ts          # Binance REST client & closed candle filtering
│   │
│   ├── indicators/
│   │   ├── ema.ts              # Exponential Moving Average calculation
│   │   ├── rsi.ts              # Wilder's Relative Strength Index
│   │   ├── macd.ts             # MACD Line, Signal Line & Histogram
│   │   ├── atr.ts              # Average True Range with Wilder's smoothing
│   │   └── volume.ts           # Volume surge & moving average ratio
│   │
│   ├── strategy/
│   │   ├── scoring.ts          # 0-100 technical scoring system
│   │   └── signal.ts           # Signal generation & confirmation filter
│   │
│   ├── risk/
│   │   └── riskManager.ts      # ATR-based SL & Risk/Reward TP calculation
│   │
│   ├── telegram/
│   │   ├── bot.ts              # Telegraf service, handlers & security check
│   │   └── formatter.ts        # Telegram HTML message templates
│   │
│   ├── scanner/
│   │   └── marketScanner.ts    # Periodic scanner, state tracking & anti-duplicate
│   │
│   └── utils/
│       └── logger.ts           # Formatted logger with token redaction
│
├── test/
│   └── verify.ts               # End-to-end indicator & Binance verification
├── config.json                 # Private configuration (ignored by git)
├── config.example.json         # Example configuration template
├── package.json                # Project dependencies & scripts
├── tsconfig.json               # TypeScript strict configuration
├── .gitignore                  # Git ignore rules
└── README.md                   # Documentation
```

---

## ⚠️ Disclaimer

Perangkat lunak ini dibuat hanya untuk tujuan edukasi dan analisa teknikal. Sinyal yang dihasilkan **bukan merupakan nasihat keuangan (financial advice)**. Trading cryptocurrency memiliki risiko finansial yang tinggi. Selalu lakukan riset Anda sendiri (*Do Your Own Research - DYOR*) dan kelola risiko secara bijak.
