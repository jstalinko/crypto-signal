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
  private baseUrl: string;
  private httpClient: AxiosInstance;

  constructor(baseUrl: string = 'https://api.binance.com') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'User-Agent': 'SpotSignalBot/1.0.0 (Node.js)'
      }
    });
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

      const response = await this.httpClient.get('/api/v3/account', {
        params: {
          timestamp,
          recvWindow: 60000,
          signature
        },
        headers: {
          'X-MBX-APIKEY': apiKey
        }
      });

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

      const response = await this.httpClient.get('/api/v3/account', {
        params: {
          timestamp,
          recvWindow: 60000,
          signature
        },
        headers: {
          'X-MBX-APIKEY': apiKey
        }
      });

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

      // Estimate USDT values
      const balances: AssetBalance[] = [];
      let totalUsdt = 0;

      for (const item of nonZeroAssets) {
        let est = 0;
        if (item.asset === 'USDT' || item.asset === 'FDUSD' || item.asset === 'USDC') {
          est = item.total;
        } else {
          // Look up price
          const pair = `${item.asset}USDT`;
          const p = priceMap?.get(pair);
          if (p && p > 0) {
            est = item.total * p;
          }
        }

        // Only include assets worth at least ~$0.10 or USDT
        if (est >= 0.1 || item.asset === 'USDT') {
          balances.push({
            asset: item.asset,
            free: item.free,
            locked: item.locked,
            total: item.total,
            estimatedUsdt: est
          });
          totalUsdt += est;
        }
      }

      // Sort: USDT first, then highest estimated value
      balances.sort((a, b) => {
        if (a.asset === 'USDT') return -1;
        if (b.asset === 'USDT') return 1;
        return b.estimatedUsdt - a.estimatedUsdt;
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
