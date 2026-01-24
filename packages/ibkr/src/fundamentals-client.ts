/**
 * IBKR Fundamentals Data Client
 * Fetches fundamental data for stocks: financials, ratios, analyst ratings, etc.
 *
 * Usage:
 * ```ts
 * const client = new FundamentalsClient();
 * await client.connect();
 * const data = await client.getFundamentals('EQNR', 'OSE');
 * await client.disconnect();
 * ```
 */

import {
  IBApi,
  EventName,
  ErrorCode,
  Contract as IBContract,
  SecType,
} from "@stoqey/ib";

export interface FundamentalsConfig {
  clientId?: number;
  host?: string;
  port?: number;
  connectionTimeout?: number;
  requestTimeout?: number;
}

export interface FinancialStatement {
  period: string;
  revenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  eps?: number;
  assets?: number;
  liabilities?: number;
  equity?: number;
  cashFlow?: number;
}

export interface KeyRatios {
  peRatio?: number;
  pbRatio?: number;
  psRatio?: number;
  dividendYield?: number;
  payoutRatio?: number;
  roe?: number;
  roa?: number;
  currentRatio?: number;
  debtToEquity?: number;
  profitMargin?: number;
}

export interface AnalystRating {
  firm?: string;
  rating?: string; // Buy, Hold, Sell
  targetPrice?: number;
  date?: string;
}

export interface DividendInfo {
  amount: number;
  exDate: string;
  payDate?: string;
  frequency?: string;
}

export interface FundamentalsData {
  symbol: string;
  exchange: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
  sharesOutstanding?: number;

  // Financial statements
  financials?: {
    annual?: FinancialStatement[];
    quarterly?: FinancialStatement[];
  };

  // Key ratios
  ratios?: KeyRatios;

  // Analyst ratings
  analystRatings?: {
    consensus?: string;
    targetPrice?: number;
    numberOfAnalysts?: number;
    ratings?: AnalystRating[];
  };

  // Dividends
  dividends?: DividendInfo[];

  // Raw XML data from IBKR
  rawData?: {
    reportSnapshot?: string;
    financialStatements?: string;
    analystForecasts?: string;
    ownershipReport?: string;
  };
}

/**
 * Report types available from IBKR
 */
export enum FundamentalsReportType {
  /** Company overview - basic info */
  COMPANY_OVERVIEW = "ReportSnapshot",

  /** Financial statements - income, balance sheet, cash flow */
  FINANCIAL_STATEMENTS = "ReportsFinStatements",

  /** Financial summary with key ratios */
  FINANCIAL_SUMMARY = "ReportRatios",

  /** Analyst estimates and forecasts */
  ANALYST_FORECASTS = "RESC",

  /** Calendar events - earnings, dividends */
  CALENDAR = "CalendarReport",
}

export class FundamentalsClient {
  private ib: IBApi;
  private config: Required<FundamentalsConfig>;
  private connected: boolean = false;
  private connectionError: string | null = null;
  private requestIdCounter: number = 1000; // Start at 1000 to avoid conflicts
  private pendingRequests: Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    data: string;
  }> = new Map();

  constructor(config: FundamentalsConfig = {}) {
    this.config = {
      clientId: config.clientId ?? Math.floor(Math.random() * 10000) + 1000,
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

  private setupEventHandlers(): void {
    this.ib.on(EventName.connected, () => {
      this.connected = true;
      this.connectionError = null;
    });

    this.ib.on(EventName.disconnected, () => {
      this.connected = false;
    });

    this.ib.on(EventName.error, (err, code, reqId) => {
      const codeNum = code as number;

      if (codeNum === ErrorCode.CONNECT_FAIL) {
        this.connectionError = "Connection failed";
        return;
      }

      if (reqId !== undefined && reqId !== -1) {
        const pending = this.pendingRequests.get(reqId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`TWS Error ${code}: ${err}`));
          this.pendingRequests.delete(reqId);
        }
      }

      const infoMessages = [2104, 2106, 2158, 2119];
      if (!infoMessages.includes(codeNum)) {
        console.error(`[Fundamentals Error ${code}] ${err} (reqId: ${reqId})`);
      }
    });

    // Handle fundamental data response
    this.ib.on(EventName.fundamentalData, (reqId: number, data: string) => {
      const pending = this.pendingRequests.get(reqId);
      if (!pending) return;

      clearTimeout(pending.timeout);
      pending.resolve(data);
      this.pendingRequests.delete(reqId);
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.ib.connect();

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

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.ib.disconnect();
      await this.sleep(500);
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Fetch fundamental data for a symbol
   * @param symbol Stock symbol
   * @param exchange Exchange code
   * @param reportType Type of report to fetch
   * @returns Raw XML data from IBKR
   */
  async fetchFundamentalReport(
    symbol: string,
    exchange: string,
    reportType: FundamentalsReportType = FundamentalsReportType.COMPANY_OVERVIEW,
    secType: SecType = SecType.STK,
    currency: string = "NOK"
  ): Promise<string> {
    if (!this.connected) {
      throw new Error("Not connected. Call connect() first.");
    }

    const contract: IBContract = {
      symbol: symbol.toUpperCase(),
      exchange: exchange.toUpperCase(),
      currency: currency.toUpperCase(),
      secType,
    };

    const reqId = this.getNextRequestId();

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Request timeout for ${symbol}`));
      }, this.config.requestTimeout);

      this.pendingRequests.set(reqId, {
        resolve,
        reject,
        timeout,
        data: "",
      });

      // Request fundamental data
      this.ib.reqFundamentalData(reqId, contract, reportType, []);
    });
  }

  /**
   * Fetch complete fundamental data for a symbol
   * Fetches multiple report types and combines them
   */
  async getFundamentals(
    symbol: string,
    exchange: string,
    options: {
      secType?: SecType;
      currency?: string;
      includeFinancials?: boolean;
      includeRatios?: boolean;
      includeAnalystForecasts?: boolean;
    } = {}
  ): Promise<FundamentalsData> {
    const {
      secType = SecType.STK,
      currency = "NOK",
      includeFinancials = true,
      includeRatios = true,
      includeAnalystForecasts = true,
    } = options;

    console.log(`Fetching fundamentals for ${symbol}...`);

    const fundamentals: FundamentalsData = {
      symbol: symbol.toUpperCase(),
      exchange: exchange.toUpperCase(),
      rawData: {},
    };

    try {
      // Fetch company overview
      const overview = await this.fetchFundamentalReport(
        symbol,
        exchange,
        FundamentalsReportType.COMPANY_OVERVIEW,
        secType,
        currency
      );
      fundamentals.rawData!.reportSnapshot = overview;

      // Parse basic company info from XML
      this.parseCompanyOverview(overview, fundamentals);

      await this.sleep(500); // Rate limiting

      // Fetch financial statements
      if (includeFinancials) {
        try {
          const financials = await this.fetchFundamentalReport(
            symbol,
            exchange,
            FundamentalsReportType.FINANCIAL_STATEMENTS,
            secType,
            currency
          );
          fundamentals.rawData!.financialStatements = financials;
          this.parseFinancialStatements(financials, fundamentals);
          await this.sleep(500);
        } catch (error) {
          console.warn(`Financial statements not available for ${symbol}`);
        }
      }

      // Fetch analyst forecasts
      if (includeAnalystForecasts) {
        try {
          const forecasts = await this.fetchFundamentalReport(
            symbol,
            exchange,
            FundamentalsReportType.ANALYST_FORECASTS,
            secType,
            currency
          );
          fundamentals.rawData!.analystForecasts = forecasts;
          this.parseAnalystForecasts(forecasts, fundamentals);
          await this.sleep(500);
        } catch (error) {
          console.warn(`Analyst forecasts not available for ${symbol}`);
        }
      }

    } catch (error) {
      console.error(`Failed to fetch fundamentals for ${symbol}:`, error);
      throw error;
    }

    return fundamentals;
  }

  /**
   * Parse company overview from XML
   */
  private parseCompanyOverview(xml: string, data: FundamentalsData): void {
    // Basic XML parsing - you may want to use a proper XML parser
    const nameMatch = xml.match(/<CoIDs>([^<]+)<\/CoIDs>/);
    if (nameMatch) data.companyName = nameMatch[1];

    const sectorMatch = xml.match(/<Industry>([^<]+)<\/Industry>/);
    if (sectorMatch) data.sector = sectorMatch[1];
  }

  /**
   * Parse financial statements from XML
   */
  private parseFinancialStatements(xml: string, data: FundamentalsData): void {
    // Parse financial data from XML
    // This is a simplified example - IBKR returns complex XML
    data.financials = {
      annual: [],
      quarterly: [],
    };

    // You would parse the XML here to extract:
    // - Revenue, gross profit, operating income, net income
    // - Balance sheet items
    // - Cash flow statement
  }

  /**
   * Parse analyst forecasts from XML
   */
  private parseAnalystForecasts(xml: string, data: FundamentalsData): void {
    // Parse analyst data from XML
    data.analystRatings = {
      ratings: [],
    };

    // Extract consensus, target prices, individual ratings
  }

  /**
   * Fetch fundamentals for multiple symbols
   */
  async getFundamentalsBulk(
    symbols: Array<{
      symbol: string;
      exchange: string;
      secType?: SecType;
      currency?: string;
    }>,
    options: {
      includeFinancials?: boolean;
      includeRatios?: boolean;
      includeAnalystForecasts?: boolean;
      delayMs?: number;
    } = {}
  ): Promise<Map<string, FundamentalsData>> {
    const { delayMs = 1000, ...fetchOptions } = options;
    const results = new Map<string, FundamentalsData>();

    for (const asset of symbols) {
      try {
        const data = await this.getFundamentals(
          asset.symbol,
          asset.exchange,
          {
            ...fetchOptions,
            secType: asset.secType ?? SecType.STK,
            currency: asset.currency ?? "NOK",
          }
        );
        results.set(asset.symbol, data);

        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      } catch (error) {
        console.error(`Failed to fetch fundamentals for ${asset.symbol}:`, error);
        results.set(asset.symbol, {
          symbol: asset.symbol,
          exchange: asset.exchange,
        });
      }
    }

    return results;
  }

  private getNextRequestId(): number {
    return this.requestIdCounter++;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Helper to create connected fundamentals client
 */
export async function createFundamentalsClient(
  config?: FundamentalsConfig
): Promise<FundamentalsClient> {
  const client = new FundamentalsClient(config);
  await client.connect();
  return client;
}

/**
 * Quick fetch fundamental data
 */
export async function fetchFundamentals(
  symbol: string,
  exchange: string,
  options: {
    secType?: SecType;
    currency?: string;
    includeFinancials?: boolean;
    includeRatios?: boolean;
    includeAnalystForecasts?: boolean;
  } = {}
): Promise<FundamentalsData> {
  const client = new FundamentalsClient();
  try {
    await client.connect();
    return await client.getFundamentals(symbol, exchange, options);
  } finally {
    await client.disconnect();
  }
}
