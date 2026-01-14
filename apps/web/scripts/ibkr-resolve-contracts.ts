// apps/web/scripts/ibkr-resolve-contracts.ts
import { IBKRClient, ALL_TICKERS } from "@ineqre/ibkr";
import type { Contract } from "@ineqre/ibkr";

const IBKR_BASE_URL = process.env.IBKR_GATEWAY_URL || "https://localhost:5000";

interface ContractMapping {
  ticker: string;
  conid: number | null;
  exchange: string;
  description?: string;
}

async function resolveContracts(): Promise<ContractMapping[]> {
  const client = new IBKRClient({ baseUrl: IBKR_BASE_URL });

  // Health check
  const healthy = await client.healthCheck();
  if (!healthy) {
    throw new Error("IBKR Gateway is not responding. Is it running on " + IBKR_BASE_URL + "?");
  }

  console.log("✓ IBKR Gateway connected");
  console.log("Resolving contracts for", ALL_TICKERS.length, "tickers...\n");

  const mappings: ContractMapping[] = [];

  for (const ticker of ALL_TICKERS) {
    try {
      console.log(`Searching: ${ticker}...`);
      const contract = await client.searchContract(ticker, "OSE");

      if (contract) {
        console.log(`  ✓ Found: conid=${contract.conid}, ${contract.description || "N/A"}`);
        mappings.push({
          ticker,
          conid: contract.conid,
          exchange: contract.exchange || "OSE",
          description: contract.description,
        });
      } else {
        console.log(`  ✗ Not found on OSE`);
        mappings.push({
          ticker,
          conid: null,
          exchange: "OSE",
        });
      }

      // Rate limiting: wait 100ms between requests
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`  ✗ Error:`, error);
      mappings.push({
        ticker,
        conid: null,
        exchange: "OSE",
      });
    }
  }

  return mappings;
}

async function main() {
  try {
    const mappings = await resolveContracts();

    console.log("\n=== Contract Mapping Results ===\n");

    const successful = mappings.filter((m) => m.conid !== null);
    const failed = mappings.filter((m) => m.conid === null);

    console.log(`✓ Resolved: ${successful.length}/${mappings.length}`);
    console.log(`✗ Failed: ${failed.length}/${mappings.length}\n`);

    if (failed.length > 0) {
      console.log("Failed tickers:");
      failed.forEach((m) => console.log(`  - ${m.ticker}`));
      console.log();
    }

    // Output as JSON for easy copy-paste
    console.log("=== JSON Mapping (for hardcoding if needed) ===");
    const mapping = Object.fromEntries(
      successful.map((m) => [m.ticker, m.conid])
    );
    console.log(JSON.stringify(mapping, null, 2));
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main();
