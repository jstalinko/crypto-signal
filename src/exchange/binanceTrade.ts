import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export interface AssetBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
  estimatedUsdt: number;
}

export interface AccountBalanceInfo {
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  balances: AssetBalance[];
  totalEstimatedUsdt: number;
  accountType?: string;
  updateTime: number;
}

export interface OrderExecutionResult {
  orderId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  status: string; // 'FILLED' | 'PARTIALLY_FILLED' | 'NEW' | etc.
  executedQty: number;
  cummulativeQuoteQty: number; // total USDT spent/received
  avgPrice: number;
  transactTime: number;
}

export class BinanceTradingClient {
  private primaryBaseUrl: string;
  private fallbackBaseUrl?: string;
  private currentBaseUrl: string;
  private httpClient: AxiosInstance;

  private priceCache: Map<string, number> = new Map();
  private priceCacheTime: number = 0;
  private readonly priceCacheTtlMs: number = 60000; // 60 seconds in-memory cache

  constructor(baseUrl: string = 'https://api.binance.com', fallbackBaseUrl?: string) {
    this.primaryBaseUrl = baseUrl.replace(/\/+$/, '');
    this.fallbackBaseUrl = fallbackBaseUrl?.replace(/\/+$/, '');
    this.currentBaseUrl = this.primaryBaseUrl;

    this.httpClient = axios.create({
      baseURL: this.currentBaseUrl,
      timeout: 15000,
      headers: {
        'User-Agent': 'SpotSignalBot/1.0.0 (Node.js)'
      }
    });
  }

  /**
   * Helper to execute request with automatic fallback URL on network or SSL error
   */
  private async executeWithFallback<T>(fn: (url: string) => Promise<T>): Promise<T> {
    try {
      return await fn(this.currentBaseUrl);
    } catch (err) {
      const axiosErr = err as AxiosError;
      const isNetworkOrCert = !axiosErr.response || axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ENOTFOUND' || (axiosErr.message && axiosErr.message.includes('certificate'));
      if (isNetworkOrCert && this.fallbackBaseUrl && this.currentBaseUrl !== this.fallbackBaseUrl) {
        logger.warn(`Primary Binance URL (${this.currentBaseUrl}) failed (${axiosErr.message}). Switching to fallback: ${this.fallbackBaseUrl}`);
        this.currentBaseUrl = this.fallbackBaseUrl;
        return await fn(this.currentBaseUrl);
      }
      throw err;
    }
  }

  /**
   * Clear in-memory ticker price cache to force a fresh fetch
   */
  public clearPriceCache(): void {
    this.priceCache.clear();
    this.priceCacheTime = 0;
  }

  /**
   * Fetch all ticker prices from Binance public API with in-memory caching and fallback endpoints
   */
  public async fetchTickerPrices(forceRefresh: boolean = false): Promise<Map<string, number>> {
    const now = Date.now();
    if (!forceRefresh && this.priceCache.size > 0 && now - this.priceCacheTime < this.priceCacheTtlMs) {
      return this.priceCache;
    }

    const candidateUrls = [this.currentBaseUrl];
    if (this.fallbackBaseUrl && !candidateUrls.includes(this.fallbackBaseUrl)) {
      candidateUrls.push(this.fallbackBaseUrl);
    }
    if (!candidateUrls.includes('https://data-api.binance.vision')) {
      candidateUrls.push('https://data-api.binance.vision');
    }

    for (const url of candidateUrls) {
      try {
        const response = await this.httpClient.get<Array<{ symbol: string; price: string }>>(
          `${url}/api/v3/ticker/price`,
          { timeout: 10000 }
        );

        if (Array.isArray(response.data) && response.data.length > 0) {
          const newMap = new Map<string, number>();
          for (const item of response.data) {
            if (item.symbol && item.price) {
              newMap.set(item.symbol.toUpperCase(), parseFloat(item.price));
            }
          }
          this.priceCache = newMap;
          this.priceCacheTime = now;
          this.currentBaseUrl = url;
          return this.priceCache;
        }
      } catch (err) {
        logger.warn(`Failed to fetch live ticker prices from ${url}: ${(err as Error).message}`);
      }
    }

    return this.priceCache;
  }

  /**
   * Estimate asset value in USDT using direct stablecoins, USDT pairs,
   * alternative stablecoin pairs (USDC, FDUSD), or crypto bridges (BTC, ETH, BNB).
   */
  public estimateAssetValueInUsdt(
    asset: string,
    quantity: number,
    prices: Map<string, number>
  ): { estimatedUsdt: number; priceFound: boolean } {
    const sym = asset.toUpperCase();
    if (quantity <= 0) {
      return { estimatedUsdt: 0, priceFound: true };
    }

    // 1. Direct USD Stablecoins
    if (sym === 'USDT' || sym === 'FDUSD' || sym === 'USDC' || sym === 'BUSD' || sym === 'DAI' || sym === 'TUSD') {
      const stableUsdtPrice = sym === 'USDT' ? 1 : (prices.get(`${sym}USDT`) ?? 1);
      return { estimatedUsdt: quantity * stableUsdtPrice, priceFound: true };
    }

    // 2. Direct USDT pair (e.g. BTCUSDT, ONDOUSDT, SOLUSDT, ETHUSDT)
    const usdtPrice = prices.get(`${sym}USDT`);
    if (usdtPrice && usdtPrice > 0) {
      return { estimatedUsdt: quantity * usdtPrice, priceFound: true };
    }

    // 3. USDC pair (e.g. BTCUSDC, ONDOUSDC)
    const usdcPrice = prices.get(`${sym}USDC`);
    if (usdcPrice && usdcPrice > 0) {
      const usdcUsdt = prices.get('USDCUSDT') ?? 1;
      return { estimatedUsdt: quantity * usdcPrice * usdcUsdt, priceFound: true };
    }

    // 4. FDUSD pair
    const fdusdPrice = prices.get(`${sym}FDUSD`);
    if (fdusdPrice && fdusdPrice > 0) {
      const fdusdUsdt = prices.get('FDUSDUSDT') ?? 1;
      return { estimatedUsdt: quantity * fdusdPrice * fdusdUsdt, priceFound: true };
    }

    // 5. BTC bridge (e.g. ETHBTC, ALTSBTC)
    const btcPrice = prices.get(`${sym}BTC`);
    const btcUsdt = prices.get('BTCUSDT');
    if (btcPrice && btcPrice > 0 && btcUsdt && btcUsdt > 0) {
      return { estimatedUsdt: quantity * btcPrice * btcUsdt, priceFound: true };
    }

    // 6. ETH bridge
    const ethPrice = prices.get(`${sym}ETH`);
    const ethUsdt = prices.get('ETHUSDT');
    if (ethPrice && ethPrice > 0 && ethUsdt && ethUsdt > 0) {
      return { estimatedUsdt: quantity * ethPrice * ethUsdt, priceFound: true };
    }

    // 7. BNB bridge
    const bnbPrice = prices.get(`${sym}BNB`);
    const bnbUsdt = prices.get('BNBUSDT');
    if (bnbPrice && bnbPrice > 0 && bnbUsdt && bnbUsdt > 0) {
      return { estimatedUsdt: quantity * bnbPrice * bnbUsdt, priceFound: true };
    }

    return { estimatedUsdt: 0, priceFound: false };
  }

  /**
   * Helper to sign query string with HMAC-SHA256
   */
  private createSignature(queryString: string, apiSecret: string): string {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
  }

  /**
   * Test user API Key and Secret by calling GET /api/v3/account
   */
  public async testCredentials(
    apiKey: string,
    apiSecret: string
  ): Promise<{ success: boolean; canTrade: boolean; canRead: boolean; error?: string }> {
    try {
      const timestamp = Date.now();
      const query = `timestamp=${timestamp}&recvWindow=60000`;
      const signature = this.createSignature(query, apiSecret);

      const response = await this.executeWithFallback(url =>
        this.httpClient.get('/api/v3/account', {
          baseURL: url,
          params: {
            timestamp,
            recvWindow: 60000,
            signature
          },
          headers: {
            'X-MBX-APIKEY': apiKey
          }
        })
      );

      const data = response.data;
      return {
        success: true,
        canTrade: Boolean(data.canTrade),
        canRead: true
      };
    } catch (err) {
      const axiosErr = err as AxiosError<{ code?: number; msg?: string }>;
      const errorMsg = axiosErr.response?.data?.msg || axiosErr.message;
      logger.warn(`Binance credentials verification failed: ${errorMsg}`);
      return {
        success: false,
        canTrade: false,
        canRead: false,
        error: errorMsg
      };
    }
  }

  /**
   * Fetch Spot wallet balances and compute estimated USDT value
   */
  public async getAccountBalances(
    apiKey: string,
    apiSecret: string,
    priceMap?: Map<string, number>
  ): Promise<AccountBalanceInfo> {
    try {
      const timestamp = Date.now();
      const query = `timestamp=${timestamp}&recvWindow=60000`;
      const signature = this.createSignature(query, apiSecret);

      const response = await this.executeWithFallback(url =>
        this.httpClient.get('/api/v3/account', {
          baseURL: url,
          params: {
            timestamp,
            recvWindow: 60000,
            signature
          },
          headers: {
            'X-MBX-APIKEY': apiKey
          }
        })
      );

      const data = response.data;
      const rawBalances: Array<{ asset: string; free: string; locked: string }> = data.balances || [];

      // Filter only assets with non-zero balance
      const nonZeroAssets = rawBalances
        .map(b => ({
          asset: b.asset,
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
          total: parseFloat(b.free) + parseFloat(b.locked)
        }))
        .filter(b => b.total > 0.00000001);

      // Fetch live prices automatically if not provided
      const prices = (priceMap && priceMap.size > 0)
        ? priceMap
        : await this.fetchTickerPrices();

      // Estimate USDT values and filter relevant assets
      const balances: AssetBalance[] = [];
      let totalUsdt = 0;

      for (const item of nonZeroAssets) {
        const { estimatedUsdt, priceFound } = this.estimateAssetValueInUsdt(item.asset, item.total, prices);

        const isStable = ['USDT', 'FDUSD', 'USDC'].includes(item.asset.toUpperCase());
        // Inclusion criteria:
        // 1. Worth >= $0.10 (filters microscopic dust fractions)
        // 2. Or is a main USD stablecoin with >= $0.01
        // 3. Or price not found (e.g. unlisted token or temporary price outage) but quantity is non-zero
        const shouldInclude =
          estimatedUsdt >= 0.1 ||
          (isStable && item.total >= 0.01) ||
          (!priceFound && item.total >= 0.00001);

        if (shouldInclude) {
          balances.push({
            asset: item.asset,
            free: item.free,
            locked: item.locked,
            total: item.total,
            estimatedUsdt
          });
          totalUsdt += estimatedUsdt;
        }
      }

      // Sort: USDT first, then highest estimated value, then unpriced assets by total quantity
      balances.sort((a, b) => {
        if (a.asset === 'USDT') return -1;
        if (b.asset === 'USDT') return 1;
        if (b.estimatedUsdt !== a.estimatedUsdt) {
          return b.estimatedUsdt - a.estimatedUsdt;
        }
        return b.total - a.total;
      });

      return {
        canTrade: Boolean(data.canTrade),
        canWithdraw: Boolean(data.canWithdraw),
        canDeposit: Boolean(data.canDeposit),
        balances,
        totalEstimatedUsdt: totalUsdt,
        accountType: data.accountType,
        updateTime: Number(data.updateTime || Date.now())
      };
    } catch (err) {
      const axiosErr = err as AxiosError<{ code?: number; msg?: string }>;
      const msg = axiosErr.response?.data?.msg || axiosErr.message;
      throw new Error(`Gagal mengambil saldo Binance: ${msg}`);
    }
  }

  /**
   * Execute Market Buy on Binance Spot using Quote Order Qty (USDT amount)
   */
  public async executeMarketBuy(
    apiKey: string,
    apiSecret: string,
    symbol: string,
    usdtAmount: number
  ): Promise<OrderExecutionResult> {
    if (usdtAmount < 5) {
      throw new Error(`Minimal pembelian di Binance adalah $5.00 USDT (diinput: $${usdtAmount.toFixed(2)}).`);
    }

    const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const timestamp = Date.now();
    const formattedAmount = usdtAmount.toFixed(2);

    const query = `symbol=${cleanSymbol}&side=BUY&type=MARKET&quoteOrderQty=${formattedAmount}&recvWindow=60000&timestamp=${timestamp}`;
    const signature = this.createSignature(query, apiSecret);

    try {
      const response = await this.executeWithFallback(url =>
        this.httpClient.post(
          `/api/v3/order?${query}&signature=${signature}`,
          null,
          {
            baseURL: url,
            headers: {
              'X-MBX-APIKEY': apiKey
            }
          }
        )
      );

      const data = response.data;
      const executedQty = parseFloat(data.executedQty || '0');
      const cummulativeQuoteQty = parseFloat(data.cummulativeQuoteQty || '0');
      const avgPrice = executedQty > 0 ? cummulativeQuoteQty / executedQty : 0;

      return {
        orderId: data.orderId,
        symbol: data.symbol,
        side: 'BUY',
        type: data.type,
        status: data.status,
        executedQty,
        cummulativeQuoteQty,
        avgPrice,
        transactTime: Number(data.transactTime || Date.now())
      };
    } catch (err) {
      const axiosErr = err as AxiosError<{ code?: number; msg?: string }>;
      const msg = axiosErr.response?.data?.msg || axiosErr.message;
      throw new Error(`Gagal eksekusi order beli di Binance: ${msg}`);
    }
  }

  /**
   * Execute Market Sell on Binance Spot
   */
  public async executeMarketSell(
    apiKey: string,
    apiSecret: string,
    symbol: string,
    quantity: number
  ): Promise<OrderExecutionResult> {
    const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const timestamp = Date.now();

    const query = `symbol=${cleanSymbol}&side=SELL&type=MARKET&quantity=${quantity}&recvWindow=60000&timestamp=${timestamp}`;
    const signature = this.createSignature(query, apiSecret);

    try {
      const response = await this.httpClient.post(
        `/api/v3/order?${query}&signature=${signature}`,
        null,
        {
          headers: {
            'X-MBX-APIKEY': apiKey
          }
        }
      );

      const data = response.data;
      const executedQty = parseFloat(data.executedQty || '0');
      const cummulativeQuoteQty = parseFloat(data.cummulativeQuoteQty || '0');
      const avgPrice = executedQty > 0 ? cummulativeQuoteQty / executedQty : 0;

      return {
        orderId: data.orderId,
        symbol: data.symbol,
        side: 'SELL',
        type: data.type,
        status: data.status,
        executedQty,
        cummulativeQuoteQty,
        avgPrice,
        transactTime: Number(data.transactTime || Date.now())
      };
    } catch (err) {
      const axiosErr = err as AxiosError<{ code?: number; msg?: string }>;
      const msg = axiosErr.response?.data?.msg || axiosErr.message;
      throw new Error(`Gagal eksekusi order jual di Binance: ${msg}`);
    }
  }
}
