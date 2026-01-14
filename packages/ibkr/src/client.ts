// packages/ibkr/src/client.ts
import type { IBKRConfig, Contract, HistoricalDataResponse, PriceData } from "./types";
import { ContractSchema, HistoricalDataResponseSchema } from "./types";

export class IBKRClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: IBKRConfig) {
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Search for a contract by symbol and exchange
   */
  async searchContract(symbol: string, exchange: string = "OSE"): Promise<Contract | null> {
    try {
      const url = `${this.baseUrl}/v1/api/iserver/secdef/search`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name: true }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`Contract search failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Filter for Oslo Stock Exchange
      const contracts = Array.isArray(data) ? data : [];
      const match = contracts.find(
        (c: any) => c.exchange === exchange || c.exchange?.toUpperCase() === exchange.toUpperCase()
      );

      if (!match) {
        return null;
      }

      return ContractSchema.parse(match);
    } catch (error) {
      console.error(`[IBKR] Contract search failed for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Fetch historical data for a contract
   * @param conid Contract ID
   * @param period Period (e.g., "10y", "1y", "6m")
   * @param bar Bar size (e.g., "1d", "1h")
   */
  async getHistoricalData(
    conid: number,
    period: string = "10y",
    bar: string = "1d"
  ): Promise<HistoricalDataResponse | null> {
    try {
      const url = `${this.baseUrl}/v1/api/hmds/history`;
      const params = new URLSearchParams({
        conid: String(conid),
        period,
        bar,
        outsideRth: "false",
      });

      const response = await fetch(`${url}?${params}`, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new Error(`Historical data fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return HistoricalDataResponseSchema.parse(data);
    } catch (error) {
      console.error(`[IBKR] Historical data fetch failed for conid ${conid}:`, error);
      return null;
    }
  }

  /**
   * Convert IBKR bar data to price data format
   */
  convertBarsToPrice(ticker: string, bars: HistoricalDataResponse["data"]): PriceData[] {
    if (!bars || bars.length === 0) {
      return [];
    }

    return bars.map((bar) => {
      const date = new Date(bar.t);
      return {
        ticker: ticker.toUpperCase(),
        date: date.toISOString().slice(0, 10),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: Math.round(bar.v),
      };
    });
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/v1/api/tickle`;
      const response = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
