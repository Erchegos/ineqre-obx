/**
 * Seed FX Fundamental Exposure Data
 *
 * Populates fx_fundamental_exposure with revenue/cost currency splits
 * for major OSE companies. Data from annual reports (approximate).
 *
 * Usage:
 *   npx tsx scripts/seed-fx-exposures.ts [--dry-run]
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

const dryRun = process.argv.includes("--dry-run");

interface CompanyExposure {
  ticker: string;
  fiscalYear: number;
  revenue: { usd: number; eur: number; gbp: number; nok: number; sek: number; other: number };
  cost: { usd: number; eur: number; gbp: number; nok: number; sek: number; other: number };
  source: string;
  notes?: string;
}

// Revenue/cost splits from annual reports (approximate %, as decimals)
// Default cost assumption: 70% NOK, 30% in revenue currency (if no data)
const EXPOSURES: CompanyExposure[] = [
  // Energy
  { ticker: "EQNR", fiscalYear: 2025, revenue: { usd: 0.80, eur: 0.10, gbp: 0.05, nok: 0.05, sek: 0, other: 0 }, cost: { usd: 0.25, eur: 0.05, gbp: 0.05, nok: 0.60, sek: 0, other: 0.05 }, source: "annual_report", notes: "Global oil/gas, USD-denominated revenue" },
  { ticker: "AKRBP", fiscalYear: 2025, revenue: { usd: 0.85, eur: 0.05, gbp: 0.05, nok: 0.05, sek: 0, other: 0 }, cost: { usd: 0.30, eur: 0.05, gbp: 0.05, nok: 0.55, sek: 0, other: 0.05 }, source: "annual_report", notes: "E&P, NCS focused" },
  { ticker: "VAR", fiscalYear: 2025, revenue: { usd: 0.75, eur: 0.15, gbp: 0.05, nok: 0.05, sek: 0, other: 0 }, cost: { usd: 0.35, eur: 0.10, gbp: 0.05, nok: 0.50, sek: 0, other: 0 }, source: "annual_report", notes: "Wind/oil services" },

  // Shipping (USD-denominated industry)
  { ticker: "FRO", fiscalYear: 2025, revenue: { usd: 0.95, eur: 0.03, gbp: 0, nok: 0.02, sek: 0, other: 0 }, cost: { usd: 0.60, eur: 0.05, gbp: 0, nok: 0.20, sek: 0, other: 0.15 }, source: "annual_report", notes: "Tanker, global USD" },
  { ticker: "GOGL", fiscalYear: 2025, revenue: { usd: 0.95, eur: 0.03, gbp: 0, nok: 0.02, sek: 0, other: 0 }, cost: { usd: 0.55, eur: 0.05, gbp: 0, nok: 0.25, sek: 0, other: 0.15 }, source: "annual_report", notes: "Dry bulk, global USD" },
  { ticker: "HAFNI", fiscalYear: 2025, revenue: { usd: 0.92, eur: 0.05, gbp: 0, nok: 0.03, sek: 0, other: 0 }, cost: { usd: 0.55, eur: 0.10, gbp: 0, nok: 0.25, sek: 0, other: 0.10 }, source: "annual_report", notes: "Product tanker" },
  { ticker: "FLNG", fiscalYear: 2025, revenue: { usd: 0.95, eur: 0.03, gbp: 0.02, nok: 0, sek: 0, other: 0 }, cost: { usd: 0.70, eur: 0.05, gbp: 0, nok: 0.15, sek: 0, other: 0.10 }, source: "annual_report", notes: "LNG carrier" },

  // Seafood (NOK/EUR mix)
  { ticker: "MOWI", fiscalYear: 2025, revenue: { usd: 0.15, eur: 0.45, gbp: 0.10, nok: 0.20, sek: 0, other: 0.10 }, cost: { usd: 0.05, eur: 0.10, gbp: 0.05, nok: 0.65, sek: 0, other: 0.15 }, source: "annual_report", notes: "Global salmon" },
  { ticker: "SALM", fiscalYear: 2025, revenue: { usd: 0.15, eur: 0.40, gbp: 0.10, nok: 0.25, sek: 0, other: 0.10 }, cost: { usd: 0.05, eur: 0.05, gbp: 0.05, nok: 0.70, sek: 0, other: 0.15 }, source: "annual_report", notes: "Norwegian salmon" },
  { ticker: "LSG", fiscalYear: 2025, revenue: { usd: 0.15, eur: 0.50, gbp: 0.10, nok: 0.20, sek: 0, other: 0.05 }, cost: { usd: 0.05, eur: 0.10, gbp: 0.05, nok: 0.65, sek: 0, other: 0.15 }, source: "annual_report", notes: "Lerøy seafood" },
  { ticker: "AUSS", fiscalYear: 2025, revenue: { usd: 0.20, eur: 0.35, gbp: 0.10, nok: 0.25, sek: 0, other: 0.10 }, cost: { usd: 0.05, eur: 0.05, gbp: 0.05, nok: 0.70, sek: 0, other: 0.15 }, source: "annual_report", notes: "Austevoll seafood" },

  // Telecom/Consumer (mostly NOK/Nordic)
  { ticker: "TEL", fiscalYear: 2025, revenue: { usd: 0.05, eur: 0.10, gbp: 0, nok: 0.55, sek: 0.25, other: 0.05 }, cost: { usd: 0.05, eur: 0.05, gbp: 0, nok: 0.60, sek: 0.20, other: 0.10 }, source: "annual_report", notes: "Telenor, Nordic telco" },
  { ticker: "ORKLA", fiscalYear: 2025, revenue: { usd: 0, eur: 0.15, gbp: 0.05, nok: 0.40, sek: 0.15, other: 0.25 }, cost: { usd: 0, eur: 0.10, gbp: 0.05, nok: 0.45, sek: 0.15, other: 0.25 }, source: "annual_report", notes: "Consumer goods, Nordic" },

  // Banks (mostly NOK)
  { ticker: "DNB", fiscalYear: 2025, revenue: { usd: 0.05, eur: 0.10, gbp: 0, nok: 0.85, sek: 0, other: 0 }, cost: { usd: 0.03, eur: 0.05, gbp: 0, nok: 0.90, sek: 0, other: 0.02 }, source: "annual_report", notes: "Largest Norwegian bank" },
  { ticker: "MORG", fiscalYear: 2025, revenue: { usd: 0.10, eur: 0.15, gbp: 0, nok: 0.70, sek: 0, other: 0.05 }, cost: { usd: 0.05, eur: 0.10, gbp: 0, nok: 0.80, sek: 0, other: 0.05 }, source: "annual_report", notes: "Investment management" },
  { ticker: "SRBNK", fiscalYear: 2025, revenue: { usd: 0.02, eur: 0.03, gbp: 0, nok: 0.95, sek: 0, other: 0 }, cost: { usd: 0.02, eur: 0.03, gbp: 0, nok: 0.95, sek: 0, other: 0 }, source: "annual_report", notes: "Regional bank" },

  // Industrial/Tech (mixed)
  { ticker: "NHYDRO", fiscalYear: 2025, revenue: { usd: 0.30, eur: 0.40, gbp: 0.05, nok: 0.15, sek: 0, other: 0.10 }, cost: { usd: 0.15, eur: 0.20, gbp: 0.05, nok: 0.50, sek: 0, other: 0.10 }, source: "annual_report", notes: "Aluminium, global" },
  { ticker: "YAR", fiscalYear: 2025, revenue: { usd: 0.25, eur: 0.35, gbp: 0.05, nok: 0.10, sek: 0, other: 0.25 }, cost: { usd: 0.15, eur: 0.25, gbp: 0.05, nok: 0.40, sek: 0, other: 0.15 }, source: "annual_report", notes: "Fertilizer, global" },
  { ticker: "TOMRA", fiscalYear: 2025, revenue: { usd: 0.20, eur: 0.50, gbp: 0.05, nok: 0.15, sek: 0, other: 0.10 }, cost: { usd: 0.10, eur: 0.30, gbp: 0.05, nok: 0.45, sek: 0, other: 0.10 }, source: "annual_report", notes: "Recycling tech" },


  // Real Estate (100% NOK)
  { ticker: "ENTRA", fiscalYear: 2025, revenue: { usd: 0, eur: 0.02, gbp: 0, nok: 0.98, sek: 0, other: 0 }, cost: { usd: 0, eur: 0.02, gbp: 0, nok: 0.95, sek: 0, other: 0.03 }, source: "annual_report", notes: "Norwegian commercial RE" },
  { ticker: "OLAV", fiscalYear: 2025, revenue: { usd: 0, eur: 0.05, gbp: 0, nok: 0.95, sek: 0, other: 0 }, cost: { usd: 0, eur: 0.03, gbp: 0, nok: 0.93, sek: 0, other: 0.04 }, source: "annual_report", notes: "Norwegian RE" },
];

const TAX_RATE = 0.22;
const DEFAULT_LEVERAGE = 1.5;

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Seeding FX Fundamental Exposure Data");
  console.log("═══════════════════════════════════════════════════════\n");

  if (dryRun) console.log("(DRY RUN — no database writes)\n");

  let inserted = 0;
  let updated = 0;

  for (const exp of EXPOSURES) {
    const { ticker, fiscalYear, revenue, cost, source, notes } = exp;

    // Calculate net exposure and sensitivities
    const netUsd = revenue.usd - cost.usd;
    const netEur = revenue.eur - cost.eur;
    const netGbp = revenue.gbp - cost.gbp;
    const netSek = revenue.sek - cost.sek;

    const afterTaxLeverage = (1 - TAX_RATE) * DEFAULT_LEVERAGE;

    const label = `  ${ticker.padEnd(8)} FY${fiscalYear}`;

    if (dryRun) {
      console.log(`${label} — Net USD: ${(netUsd * 100).toFixed(0)}%, EUR: ${(netEur * 100).toFixed(0)}%, GBP: ${(netGbp * 100).toFixed(0)}%`);
      continue;
    }

    try {
      const result = await pool.query(
        `INSERT INTO fx_fundamental_exposure (
          ticker, fiscal_year,
          revenue_usd_pct, revenue_eur_pct, revenue_gbp_pct, revenue_nok_pct, revenue_sek_pct, revenue_other_pct,
          cost_usd_pct, cost_eur_pct, cost_gbp_pct, cost_nok_pct, cost_sek_pct, cost_other_pct,
          net_usd_pct, net_eur_pct, net_gbp_pct, net_sek_pct,
          ebitda_sensitivity_usd, ebitda_sensitivity_eur, ebitda_sensitivity_gbp,
          eps_sensitivity_usd, eps_sensitivity_eur, eps_sensitivity_gbp,
          source, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
        ON CONFLICT (ticker, fiscal_year) DO UPDATE SET
          revenue_usd_pct = EXCLUDED.revenue_usd_pct,
          revenue_eur_pct = EXCLUDED.revenue_eur_pct,
          revenue_gbp_pct = EXCLUDED.revenue_gbp_pct,
          revenue_nok_pct = EXCLUDED.revenue_nok_pct,
          revenue_sek_pct = EXCLUDED.revenue_sek_pct,
          revenue_other_pct = EXCLUDED.revenue_other_pct,
          cost_usd_pct = EXCLUDED.cost_usd_pct,
          cost_eur_pct = EXCLUDED.cost_eur_pct,
          cost_gbp_pct = EXCLUDED.cost_gbp_pct,
          cost_nok_pct = EXCLUDED.cost_nok_pct,
          cost_sek_pct = EXCLUDED.cost_sek_pct,
          cost_other_pct = EXCLUDED.cost_other_pct,
          net_usd_pct = EXCLUDED.net_usd_pct,
          net_eur_pct = EXCLUDED.net_eur_pct,
          net_gbp_pct = EXCLUDED.net_gbp_pct,
          net_sek_pct = EXCLUDED.net_sek_pct,
          ebitda_sensitivity_usd = EXCLUDED.ebitda_sensitivity_usd,
          ebitda_sensitivity_eur = EXCLUDED.ebitda_sensitivity_eur,
          ebitda_sensitivity_gbp = EXCLUDED.ebitda_sensitivity_gbp,
          eps_sensitivity_usd = EXCLUDED.eps_sensitivity_usd,
          eps_sensitivity_eur = EXCLUDED.eps_sensitivity_eur,
          eps_sensitivity_gbp = EXCLUDED.eps_sensitivity_gbp,
          source = EXCLUDED.source,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert`,
        [
          ticker, fiscalYear,
          revenue.usd, revenue.eur, revenue.gbp, revenue.nok, revenue.sek, revenue.other,
          cost.usd, cost.eur, cost.gbp, cost.nok, cost.sek, cost.other,
          netUsd, netEur, netGbp, netSek,
          netUsd, netEur, netGbp,
          netUsd * afterTaxLeverage, netEur * afterTaxLeverage, netGbp * afterTaxLeverage,
          source, notes || null,
        ]
      );

      const isInsert = result.rows[0]?.is_insert;
      console.log(`${label} — ${isInsert ? "inserted" : "updated"}`);
      if (isInsert) inserted++;
      else updated++;
    } catch (err: any) {
      console.error(`${label} — ERROR: ${err.message}`);
    }
  }

  console.log(`\n  Done: ${inserted} inserted, ${updated} updated (${EXPOSURES.length} total)`);
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
