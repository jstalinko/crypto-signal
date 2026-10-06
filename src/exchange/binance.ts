import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../utils/logger.js';

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface ExchangeClient {
  getCandles(
    symbol: string,
    timeframe: string,
    limit: number
  ): Promise<Candle[]>;
  ping(): Promise<boolean>;
  getTopUsdtSymbols(limit?: number): Promise<string[]>;
  getPrice(symbol: string): Promise<number>;
  getPrices(symbols: string[]): Promise<Map<string, number>>;
}

export class BinanceClient implements ExchangeClient {
  private primaryBaseUrl: string;
  private fallbackBaseUrl?: string;
  private currentBaseUrl: string;
  private httpClient: AxiosInstance;
  private maxRetries = 3;
  private baseDelayMs = 1000;

  constructor(baseUrl: string = 'https://api.binance.com', fallbackBaseUrl?: string) {
    this.primaryBaseUrl = baseUrl.replace(/\/+$/, '');
    this.fallbackBaseUrl = fallbackBaseUrl?.replace(/\/+$/, '');
    this.currentBaseUrl = this.primaryBaseUrl;

    this.httpClient = axios.create({
      timeout: 10000,
      headers: {
        'User-Agent': 'SpotSignalBot/1.0.0 (Node.js)'
      }
    });
  }

  /**
   * Ping exchange to verify connectivity
   */
  public async ping(): Promise<boolean> {
    try {
      await this.requestWithRetry('/api/v3/ping');
      return true;
    } catch (err) {
      logger.warn(`Binance ping failed on ${this.currentBaseUrl}: ${(err as Error).message}`);
      // Try fallback if available
      if (this.fallbackBaseUrl && this.currentBaseUrl !== this.fallbackBaseUrl) {
        logger.info(`Attempting fallback to ${this.fallbackBaseUrl}...`);
        this.currentBaseUrl = this.fallbackBaseUrl;
        try {
          await this.requestWithRetry('/api/v3/ping');
          logger.info(`Connected successfully to fallback exchange URL: ${this.currentBaseUrl}`);
          return true;
        } catch (fallbackErr) {
          logger.error(`Fallback ping also failed: ${(fallbackErr as Error).message}`);
        }
      }
      return false;
    }
  }

  /**
   * Fetch candlesticks from Binance Public REST API.
   * Ensures only CLOSED candles are returned (eliminates repainting).
   */
  public async getCandles(
    symbol: string,
    timeframe: string,
    limit: number
  ): Promise<Candle[]> {
    // Request limit + 2 candles so that after dropping the in-progress candle,
    // we still have at least the requested number of closed candles.
    const requestedLimit = Math.min(limit + 5, 1000);
    const endpoint = `/api/v3/klines`;
    const params = {
      symbol: symbol.toUpperCase(),
      interval: timeframe,
      limit: requestedLimit
    };

    const response = await this.requestWithRetry<Array<Array<string | number>>>(endpoint, params);

    if (!Array.isArray(response) || response.length === 0) {
      throw new Error(`Empty klines response received for ${symbol}`);
    }

    const now = Date.now();
    const rawCandles: Candle[] = response.map((item) => ({
      openTime: Number(item[0]),
      open: parseFloat(String(item[1])),
      high: parseFloat(String(item[2])),
      low: parseFloat(String(item[3])),
      close: parseFloat(String(item[4])),
      volume: parseFloat(String(item[5])),
      closeTime: Number(item[6])
    }));

    // Filter out any candle that is not yet fully closed
    // A candle is still open if candle.closeTime > current server/local time
    const closedCandles = rawCandles.filter(candle => candle.closeTime <= now);

    // In rare edge cases where local clock might be slightly off (a few seconds behind),
    // ensure at least the very last candle is excluded if it looks currently active
    if (closedCandles.length === rawCandles.length && rawCandles.length > 0) {
      // Discard the last candle if its closeTime is suspiciously close or ahead
      const lastCandle = rawCandles[rawCandles.length - 1];
      if (lastCandle.closeTime > now - 1000) {
        closedCandles.pop();
      }
    }

    // Return the latest requested limit of closed candles
    return closedCandles.slice(-limit);
  }

  /**
   * Fetch top USDT spot symbols by 24h volume from Binance,
   * excluding stablecoins and leveraged tokens.
   */
  public async getTopUsdtSymbols(limit: number = 30): Promise<string[]> {
    const STABLECOINS = new Set([
      'USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'BUSDUSDT', 'EURUSDT', 'DAIUSDT',
      'USDPUSDT', 'USD1USDT', 'RLUSDUSDT', 'AEURUSDT', 'EURIUSDT', 'WBETHUSDT',
      'WBTCUSDT', 'USTCUSDT', 'PAXUSDT', 'XAUTUSDT'
    ]);

    try {
      const endpoint = '/api/v3/ticker/24hr';
      const tickers = await this.requestWithRetry<Array<{ symbol: string; quoteVolume: string }>>(endpoint);

      if (!Array.isArray(tickers)) {
        return [];
      }

      return tickers
        .filter(t => {
          const s = t.symbol;
          return (
            s.endsWith('USDT') &&
            !STABLECOINS.has(s) &&
            !s.includes('UPUSDT') &&
            !s.includes('DOWNUSDT') &&
            !s.includes('BULLUSDT') &&
            !s.includes('BEARUSDT')
          );
        })
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, limit)
        .map(t => t.symbol);
    } catch (err) {
      logger.error(`Failed to fetch top USDT symbols: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Fetch current live price for a single symbol
   */
  public async getPrice(symbol: string): Promise<number> {
    const endpoint = '/api/v3/ticker/price';
    const res = await this.requestWithRetry<{ symbol: string; price: string }>(endpoint, {
      symbol: symbol.toUpperCase()
    });
    return parseFloat(res.price);
  }

  /**
   * Fetch current live prices for multiple symbols in a single batch call
   */
  public async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();
    if (!symbols || symbols.length === 0) return priceMap;

    if (symbols.length === 1) {
      const sym = symbols[0].toUpperCase();
      try {
        const p = await this.getPrice(sym);
        priceMap.set(sym, p);
        return priceMap;
      } catch (err) {
        logger.warn(`Single ticker price fetch failed for ${sym}: ${(err as Error).message}. Falling back to batch request.`);
      }
    }

    const endpoint = '/api/v3/ticker/price';
    const params = {
      symbols: JSON.stringify(symbols.map(s => s.toUpperCase()))
    };

    try {
      const res = await this.requestWithRetry<Array<{ symbol: string; price: string }>>(endpoint, params);
      if (Array.isArray(res)) {
        for (const item of res) {
          priceMap.set(item.symbol, parseFloat(item.price));
        }
      }
    } catch (err) {
      logger.warn(`Batch ticker price fetch failed: ${(err as Error).message}. Falling back to individual requests.`);
      for (const sym of symbols) {
        try {
          const p = await this.getPrice(sym);
          priceMap.set(sym.toUpperCase(), p);
        } catch {
          // ignore individual symbol failure
        }
      }
    }
    return priceMap;
  }

  /**
   * Generic request with exponential backoff retry and fallback handling
   */
  private async requestWithRetry<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        const url = `${this.currentBaseUrl}${endpoint}`;
        const response = await this.httpClient.get<T>(url, { params });
        return response.data;
      } catch (error) {
        attempt++;
        const axiosErr = error as AxiosError;
        const status = axiosErr.response?.status;
        const isRateLimit = status === 429 || status === 418;
        const isServerError = status ? status >= 500 : false;
        const isNetworkError = !status || axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ENOTFOUND' || (axiosErr.message && axiosErr.message.includes('certificate'));

        // Client errors (400 Invalid Symbol, 404, etc.) should fail immediately without retries
        if (status && status >= 400 && status < 500 && !isRateLimit) {
          const errorData = axiosErr.response?.data as { code?: number; msg?: string } | undefined;
          if (errorData?.code === -1121 || (errorData?.msg && errorData.msg.toLowerCase().includes('invalid symbol'))) {
            const sym = (params?.symbol as string) || '';
            throw new Error(`Symbol ${sym ? `'${sym}' ` : ''}tidak ditemukan di Binance Spot.`);
          }
          throw new Error(`Binance error (${status}): ${errorData?.msg || axiosErr.message}`);
        }

        // If SSL / DNS blocking error occurs and fallback URL is available, switch immediately
        if (isNetworkError && this.fallbackBaseUrl && this.currentBaseUrl !== this.fallbackBaseUrl) {
          logger.warn(`Primary exchange URL (${this.currentBaseUrl}) failed (${axiosErr.message}). Switching to fallback: ${this.fallbackBaseUrl}`);
          this.currentBaseUrl = this.fallbackBaseUrl;
          // Retry immediately with the fallback
          continue;
        }

        if (attempt > this.maxRetries) {
          logger.error(`Exchange request to ${endpoint} failed after ${this.maxRetries} retries: ${axiosErr.message}`);
          throw error;
        }

        // Calculate exponential backoff delay with jitter
        const delay = this.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 300;
        logger.warn(`Exchange request failed (${axiosErr.message}). Retrying in ${(delay / 1000).toFixed(1)}s (Attempt ${attempt}/${this.maxRetries})...`);

        if (isRateLimit) {
          // If rate limited, wait a bit longer (e.g. 5 seconds)
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Max retries exceeded for ${endpoint}`);
  }
}
