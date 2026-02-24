/**
 * IBKR TWS API Client
 * Production-ready wrapper for Interactive Brokers TWS/Gateway API
 *
 * Features:
 * - Automatic connection management with reconnection
 * - Historical data fetching for any ticker
 * - Support for stocks, indices, forex
 * - Easy asset import and data ingestion
 * - Works in both Node.js scripts and Next.js API routes
 * - Comprehensive error handling
 *
 * Usage:
 * ```ts
 * const client = new TWS Client();
 * await client.connect();
 * const data = await client.getHistoricalData('AAPL', 'SMART', '1y');
 * await client.disconnect();
 * ```
 */

import {
  IBApi,
  EventName,
  ErrorCode,
  Contract as IBContract,
  SecType,
  BarSizeSetting,
  WhatToShow,
} from "@stoqey/ib";

// Re-export types for convenience
export { SecType, BarSizeSetting, WhatToShow } from "@stoqey/ib";

export interface TWSConfig {
  /** Client ID (must be unique per connection) */
  clientId?: number;
  /** IB Gateway host (default: 127.0.0.1) */
  host?: string;
  /** IB Gateway port (4002 for Gateway, 4001 for TWS) */
  port?: number;
  /** Connection timeout in ms */
  connectionTimeout?: number;
  /** Request timeout in ms */
  requestTimeout?: number;
}

export interface HistoricalBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  count?: number;
  wap?: number; // Weighted average price
}

export interface ContractDetails {
  symbol: string;
  exchange: string;
  currency: string;
  secType: SecType;
  conId?: number;
  localSymbol?: string;
  primaryExchange?: string;
}

export interface PriceData {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsHeadline {
  time: string;
  providerCode: string;
  articleId: string;
  headline: string;
}

export interface NewsArticle {
  articleType: number;
  articleText: string;
}

export interface NewsProvider {
  code: string;
  name: string;
}

export class TWSClient {
  private ib: IBApi;
  private config: Required<TWSConfig>;
  private connected: boolean = false;
  private connectionError: string | null = null;
  private requestIdCounter: number = 1;
  private pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    data: any[];
  }> = new Map();

  constructor(config: TWSConfig = {}) {
    this.config = {
      clientId: config.clientId ?? Math.floor(Math.random() * 10000),
      host: config.host ?? "127.0.0.1",
      port: config.port ?? 4002,
      connectionTimeout: config.connectionTimeout ?? 5000,
      requestTimeout: config.requestTimeout ?? 30000,
    };

    this.ib = new IBApi({
      clientId: this.config.clientId,
      host: this.config.host,
      port: this.config.port,
    });

    this.setupEventHandlers();
  }

  /**
   * Setup TWS API event handlers
   */
  private setupEventHandlers(): void {
    // Connection events
    this.ib.on(EventName.connected, () => {
      this.connected = true;
      this.connectionError = null;
    });

    this.ib.on(EventName.disconnected, () => {
      this.connected = false;
    });

    this.ib.on(EventName.error, (err, code, reqId) => {
      const codeNum = code as number;

      // Connection errors
      if (codeNum === ErrorCode.CONNECT_FAIL) {
        this.connectionError = "Connection failed - IB Gateway not running or API not enabled";
        return;
      }

      // Handle request-specific errors
      if (reqId !== undefined && reqId !== -1) {
        const pending = this.pendingRequests.get(reqId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`TWS Error ${code}: ${err}`));
          this.pendingRequests.delete(reqId);
        }
      }

      // Ignore informational messages
      const infoMessages = [2104, 2106, 2158, 2119];
      if (!infoMessages.includes(codeNum)) {
        console.error(`[TWS Error ${code}] ${err} (reqId: ${reqId})`);
      }
    });

    // Historical data handler
    (this.ib as any).on(EventName.historicalData, (reqId: number, time: string, open: number, high: number, low: number, close: number, volume: number, count: number, WAP: number) => {
      const pending = this.pendingRequests.get(reqId);
      if (!pending) return;

      // "finished" marker from IB
      if (time.startsWith("finished")) {
        clearTimeout(pending.timeout);
        pending.resolve(pending.data);
        this.pendingRequests.delete(reqId);
        return;
      }

      // Add bar to results
      pending.data.push({
        time,
        open,
        high,
        low,
        close,
        volume,
        count,
        wap: WAP,
      });
    });

    // Contract details handler (for resolving ticker → conId)
    (this.ib as any).on(EventName.contractDetails, (reqId: number, details: any) => {
      const pending = this.pendingRequests.get(reqId);
      if (pending) {
        pending.data.push(details);
      }
    });

    (this.ib as any).on(EventName.contractDetailsEnd, (reqId: number) => {
      const pending = this.pendingRequests.get(reqId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(pending.data);
        this.pendingRequests.delete(reqId);
      }
    });

    // Historical news handler
    (this.ib as any).on(EventName.historicalNews, (reqId: number, time: string, providerCode: string, articleId: string, headline: string) => {
      const pending = this.pendingRequests.get(reqId);
      if (pending) {
        pending.data.push({ time, providerCode, articleId, headline });
      }
    });

    (this.ib as any).on(EventName.historicalNewsEnd, (reqId: number, _hasMore: boolean) => {
      const pending = this.pendingRequests.get(reqId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(pending.data);
        this.pendingRequests.delete(reqId);
      }
    });

    // News article handler
    (this.ib as any).on(EventName.newsArticle, (reqId: number, articleType: number, articleText: string) => {
      const pending = this.pendingRequests.get(reqId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve({ articleType, articleText });
        this.pendingRequests.delete(reqId);
      }
    });

    // News providers handler
    (this.ib as any).on(EventName.newsProviders, (providers: any[]) => {
      // newsProviders doesn't use reqId — resolve via special key
      const pending = this.pendingRequests.get(-99);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(providers);
        this.pendingRequests.delete(-99);
      }
    });
  }

  /**
   * Connect to IB Gateway
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.ib.connect();

    // Wait for connection with timeout
    const startTime = Date.now();
    while (!this.connected && !this.connectionError) {
      if (Date.now() - startTime > this.config.connectionTimeout) {
        throw new Error("Connection timeout");
      }
      await this.sleep(100);
    }

    if (this.connectionError) {
      throw new Error(this.connectionError);
    }
  }

  /**
   * Disconnect from IB Gateway
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      this.ib.disconnect();
      await this.sleep(500);
      this.connected = false;
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Fetch historical data for a contract
   * @param symbol Stock symbol (e.g., 'AAPL', 'OBX', 'EQNR')
   * @param exchange Exchange code (e.g., 'OSE', 'SMART', 'NASDAQ')
   * @param duration Duration string (e.g., '1 Y', '6 M', '1 D')
   * @param barSize Bar size (default: '1 day')
   * @param secType Security type (default: SecType.STK)
   * @param currency Currency (default: 'NOK')
   * @param adjusted Whether to get dividend-adjusted prices (default: true)
   * @returns Array of historical bars
   */
  async getHistoricalData(
    symbol: string,
    exchange: string,
    duration: string = "1 Y",
    barSize: BarSizeSetting = BarSizeSetting.DAYS_ONE,
    secType: SecType = SecType.STK,
    currency: string = "NOK",
    adjusted: boolean = true
  ): Promise<HistoricalBar[]> {
    if (!this.connected) {
      throw new Error("Not connected to IB Gateway. Call connect() first.");
    }

    const contract: IBContract = {
      symbol: symbol.toUpperCase(),
      exchange: exchange.toUpperCase(),
      currency: currency.toUpperCase(),
      secType,
    };

    const reqId = this.getNextRequestId();

    return new Promise<HistoricalBar[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Request timeout for ${symbol}`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(reqId, {
        resolve,
        reject,
        timeout,
        data: [],
      });

      // Request historical data
      // Use ADJUSTED_LAST for dividend-adjusted prices, TRADES for raw prices
      const whatToShow = adjusted ? WhatToShow.ADJUSTED_LAST : WhatToShow.TRADES;

      this.ib.reqHistoricalData(
        reqId,
        contract,
        "", // endDateTime (empty = now)
        duration,
        barSize,
        whatToShow,
        0, // useRTH (0 = include outside regular trading hours)
        1, // formatDate (1 = yyyyMMdd HH:mm:ss)
        false // keepUpToDate
      );
    });
  }

  /**
   * Fetch historical data for multiple tickers
   * @param tickers Array of ticker symbols
   * @param exchange Exchange code
   * @param duration Duration string
   * @param options Additional options
   * @returns Map of ticker to historical bars
   */
  async getHistoricalDataBulk(
    tickers: string[],
    exchange: string,
    duration: string = "1 Y",
    options: {
      barSize?: BarSizeSetting;
      secType?: SecType;
      currency?: string;
      delayMs?: number; // Delay between requests to avoid rate limiting
    } = {}
  ): Promise<Map<string, HistoricalBar[]>> {
    const {
      barSize = BarSizeSetting.DAYS_ONE,
      secType = SecType.STK,
      currency = "NOK",
      delayMs = 100,
    } = options;

    const results = new Map<string, HistoricalBar[]>();

    for (const ticker of tickers) {
      try {
        const bars = await this.getHistoricalData(
          ticker,
          exchange,
          duration,
          barSize,
          secType,
          currency
        );
        results.set(ticker, bars);

        // Rate limiting delay
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        console.error(`Failed to fetch data for ${ticker}:`, error);
        results.set(ticker, []);
      }
    }

    return results;
  }

  /**
   * Convert historical bars to price data format (for database insertion)
   * @param ticker Ticker symbol
   * @param bars Array of historical bars
   * @returns Array of price data
   */
  convertToPriceData(ticker: string, bars: HistoricalBar[]): PriceData[] {
    return bars.map((bar) => {
      // Parse IB date format: "yyyyMMdd  HH:mm:ss" or "yyyyMMdd"
      const dateStr = bar.time.trim().split(" ")[0];
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      const date = `${year}-${month}-${day}`;

      return {
        ticker: ticker.toUpperCase(),
        date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: Math.round(bar.volume),
      };
    });
  }

  /**
   * Import historical data for a single asset
   * @param symbol Stock symbol
   * @param exchange Exchange code
   * @param duration Duration to fetch
   * @param options Additional options
   * @returns Price data ready for database insertion
   */
  async importAsset(
    symbol: string,
    exchange: string,
    duration: string = "10 Y",
    options: {
      barSize?: BarSizeSetting;
      secType?: SecType;
      currency?: string;
      adjusted?: boolean;
    } = {}
  ): Promise<PriceData[]> {
    const {
      barSize = BarSizeSetting.DAYS_ONE,
      secType = SecType.STK,
      currency = "NOK",
      adjusted = true, // Default to adjusted prices
    } = options;

    console.log(`Importing ${symbol} from ${exchange} (${adjusted ? 'adjusted' : 'raw'})...`);

    const bars = await this.getHistoricalData(
      symbol,
      exchange,
      duration,
      barSize,
      secType,
      currency,
      adjusted
    );

    const priceData = this.convertToPriceData(symbol, bars);
    console.log(`  Fetched ${priceData.length} data points`);

    return priceData;
  }

  /**
   * Import historical data for multiple assets
   * @param assets Array of asset definitions
   * @param options Additional options
   * @returns Map of ticker to price data
   */
  async importAssets(
    assets: Array<{
      symbol: string;
      exchange: string;
      secType?: SecType;
      currency?: string;
    }>,
    options: {
      duration?: string;
      barSize?: BarSizeSetting;
      delayMs?: number;
    } = {}
  ): Promise<Map<string, PriceData[]>> {
    const {
      duration = "10 Y",
      barSize = BarSizeSetting.DAYS_ONE,
      delayMs = 100,
    } = options;

    const results = new Map<string, PriceData[]>();

    for (const asset of assets) {
      try {
        const priceData = await this.importAsset(
          asset.symbol,
          asset.exchange,
          duration,
          {
            barSize,
            secType: asset.secType ?? SecType.STK,
            currency: asset.currency ?? "NOK",
          }
        );

        results.set(asset.symbol, priceData);

        // Rate limiting delay
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        console.error(`Failed to import ${asset.symbol}:`, error);
        results.set(asset.symbol, []);
      }
    }

    return results;
  }

  /**
   * Get contract details (useful for verification)
   */
  getContractDetails(
    symbol: string,
    exchange: string,
    secType: SecType = SecType.STK,
    currency: string = "NOK"
  ): ContractDetails {
    return {
      symbol: symbol.toUpperCase(),
      exchange: exchange.toUpperCase(),
      currency: currency.toUpperCase(),
      secType,
    };
  }

  /**
   * Health check - verify connection is working
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.connected) {
        return false;
      }
      // Could add a simple request here to verify
      return true;
    } catch {
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // News API Methods
  // ════════════════════════════════════════════════════════════════

  /**
   * Resolve a ticker symbol to an IBKR contract ID (conId).
   * Required for news requests which use conId, not symbol.
   */
  async resolveContractId(
    symbol: string,
    exchange: string,
    secType: SecType = SecType.STK,
    currency: string = "NOK"
  ): Promise<number> {
    if (!this.connected) {
      throw new Error("Not connected to IB Gateway. Call connect() first.");
    }

    const contract: IBContract = {
      symbol: symbol.toUpperCase(),
      exchange: exchange.toUpperCase(),
      currency: currency.toUpperCase(),
      secType,
    };

    const reqId = this.getNextRequestId();

    return new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Contract resolution timeout for ${symbol}`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(reqId, {
        resolve: (details: any[]) => {
          if (details.length === 0) {
            reject(new Error(`No contract found for ${symbol} on ${exchange}`));
            return;
          }
          const conId = details[0]?.contract?.conId ?? details[0]?.summary?.conId;
          if (!conId) {
            reject(new Error(`No conId in contract details for ${symbol}`));
            return;
          }
          resolve(conId);
        },
        reject,
        timeout,
        data: [],
      });

      this.ib.reqContractDetails(reqId, contract);
    });
  }

  /**
   * Get list of available news providers for this account.
   */
  async getNewsProviders(): Promise<NewsProvider[]> {
    if (!this.connected) {
      throw new Error("Not connected to IB Gateway. Call connect() first.");
    }

    return new Promise<NewsProvider[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(-99);
        reject(new Error("News providers request timeout"));
      }, this.config.requestTimeout);

      this.pendingRequests.set(-99, {
        resolve: (providers: any[]) => {
          resolve(
            (providers || []).map((p: any) => ({
              code: p.providerCode ?? p.code ?? "",
              name: p.providerName ?? p.name ?? "",
            }))
          );
        },
        reject,
        timeout,
        data: [],
      });

      this.ib.reqNewsProviders();
    });
  }

  /**
   * Fetch historical news headlines for a contract.
   * @param conId IBKR contract ID (use resolveContractId() first)
   * @param providerCodes Comma-separated provider codes (e.g., "BRFG,BRFUPDN,DJNL")
   * @param startDateTime Start date "yyyy-MM-dd HH:mm:ss"
   * @param endDateTime End date "yyyy-MM-dd HH:mm:ss"
   * @param totalResults Max headlines (1-300)
   */
  async getHistoricalNews(
    conId: number,
    providerCodes: string = "BRFG+BRFUPDN+DJNL",
    startDateTime: string,
    endDateTime: string,
    totalResults: number = 100
  ): Promise<NewsHeadline[]> {
    if (!this.connected) {
      throw new Error("Not connected to IB Gateway. Call connect() first.");
    }

    const reqId = this.getNextRequestId();

    return new Promise<NewsHeadline[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Historical news request timeout (conId: ${conId})`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(reqId, {
        resolve,
        reject,
        timeout,
        data: [],
      });

      this.ib.reqHistoricalNews(
        reqId,
        conId,
        providerCodes,
        startDateTime,
        endDateTime,
        totalResults
      );
    });
  }

  /**
   * Fetch the full text of a news article.
   * @param providerCode Provider code from headline (e.g., "BRFG")
   * @param articleId Article ID from headline
   */
  async getNewsArticle(
    providerCode: string,
    articleId: string
  ): Promise<NewsArticle> {
    if (!this.connected) {
      throw new Error("Not connected to IB Gateway. Call connect() first.");
    }

    const reqId = this.getNextRequestId();

    return new Promise<NewsArticle>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`News article request timeout (${articleId})`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(reqId, {
        resolve,
        reject,
        timeout,
        data: [],
      });

      this.ib.reqNewsArticle(reqId, providerCode, articleId);
    });
  }

  /**
   * Get next request ID
   */
  private getNextRequestId(): number {
    return this.requestIdCounter++;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Helper function to create a connected client
 * Handles connection automatically
 */
export async function createTWSClient(config?: TWSConfig): Promise<TWSClient> {
  const client = new TWSClient(config);
  await client.connect();
  return client;
}

/**
 * Helper function to fetch data with automatic connection management
 * Use this for one-off requests
 */
export async function fetchHistoricalData(
  symbol: string,
  exchange: string,
  duration: string = "1 Y",
  options: {
    barSize?: BarSizeSetting;
    secType?: SecType;
    currency?: string;
  } = {}
): Promise<PriceData[]> {
  const client = new TWSClient();
  try {
    await client.connect();
    const bars = await client.getHistoricalData(
      symbol,
      exchange,
      duration,
      options.barSize,
      options.secType,
      options.currency
    );
    return client.convertToPriceData(symbol, bars);
  } finally {
    await client.disconnect();
  }
}
