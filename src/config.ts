import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/logger.js';

export interface TelegramConfig {
  token: string;
  chatId: string;
  cooldownMinutes?: number;
}

export interface ExchangeConfig {
  baseUrl: string;
  fallbackBaseUrl?: string;
}

export interface TradingConfig {
  symbols: string[];
  timeframe: string;
  candleLimit: number;
  scanIntervalSeconds: number;
}

export interface StrategyConfig {
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  rsiPeriod: number;
  atrPeriod: number;
  volumePeriod: number;
  buyThreshold: number;
}

export interface AppConfig {
  telegram: TelegramConfig;
  exchange: ExchangeConfig;
  trading: TradingConfig;
  strategy: StrategyConfig;
}

const DEFAULT_CONFIG_FILENAME = 'config.json';

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = configPath || path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);

  if (!fs.existsSync(resolvedPath)) {
    logger.error(`Config file not found at: ${resolvedPath}`);
    logger.error(`Please copy 'config.example.json' to 'config.json' and fill in your Telegram credentials.`);
    process.exit(1);
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  } catch (err) {
    logger.error(`Failed to read config file: ${(err as Error).message}`);
    process.exit(1);
  }

  let parsed: Partial<AppConfig>;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    logger.error(`Malformed JSON in ${DEFAULT_CONFIG_FILENAME}: ${(err as Error).message}`);
    process.exit(1);
  }

  // Validate Telegram Config
  if (!parsed.telegram || !parsed.telegram.token || parsed.telegram.token.trim() === '' || parsed.telegram.token === 'YOUR_TELEGRAM_BOT_TOKEN') {
    logger.error('Telegram bot token is missing or placeholder in config.json');
    logger.error('Please configure a valid telegram.token in config.json');
    process.exit(1);
  }

  if (!parsed.telegram.chatId || parsed.telegram.chatId.trim() === '' || parsed.telegram.chatId === 'YOUR_CHAT_ID') {
    logger.error('Telegram chatId is missing or placeholder in config.json');
    logger.error('Please configure a valid telegram.chatId in config.json');
    process.exit(1);
  }

  // Validate Exchange Config
  const exchangeBaseUrl = parsed.exchange?.baseUrl?.trim() || 'https://api.binance.com';
  const fallbackBaseUrl = parsed.exchange?.fallbackBaseUrl?.trim() || 'https://data-api.binance.vision';

  // Validate Trading Config
  if (!parsed.trading || !Array.isArray(parsed.trading.symbols) || parsed.trading.symbols.length === 0) {
    logger.error('trading.symbols must be a non-empty array of strings in config.json');
    process.exit(1);
  }

  const symbols = parsed.trading.symbols.map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
  if (symbols.length === 0) {
    logger.error('No valid trading symbols found in config.json');
    process.exit(1);
  }

  const timeframe = parsed.trading.timeframe?.trim() || '15m';
  const candleLimit = Number(parsed.trading.candleLimit) > 50 ? Number(parsed.trading.candleLimit) : 250;
  const scanIntervalSeconds = Number(parsed.trading.scanIntervalSeconds) > 5 ? Number(parsed.trading.scanIntervalSeconds) : 60;
  const cooldownMinutes = Number(parsed.telegram.cooldownMinutes) >= 1 ? Number(parsed.telegram.cooldownMinutes) : 30;

  // Validate Strategy Config
  const strategy: StrategyConfig = {
    emaFast: Number(parsed.strategy?.emaFast) || 20,
    emaSlow: Number(parsed.strategy?.emaSlow) || 50,
    emaTrend: Number(parsed.strategy?.emaTrend) || 200,
    rsiPeriod: Number(parsed.strategy?.rsiPeriod) || 14,
    atrPeriod: Number(parsed.strategy?.atrPeriod) || 14,
    volumePeriod: Number(parsed.strategy?.volumePeriod) || 20,
    buyThreshold: Number(parsed.strategy?.buyThreshold) || 75
  };

  const config: AppConfig = {
    telegram: {
      token: parsed.telegram.token.trim(),
      chatId: parsed.telegram.chatId.trim(),
      cooldownMinutes
    },
    exchange: {
      baseUrl: exchangeBaseUrl,
      fallbackBaseUrl
    },
    trading: {
      symbols,
      timeframe,
      candleLimit,
      scanIntervalSeconds
    },
    strategy
  };

  return config;
}
