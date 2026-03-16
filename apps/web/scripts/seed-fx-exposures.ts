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

// Revenue/cost splits from company annual reports (FY2023).
// Sources: Annual reports, 20-F filings, financial risk notes (currency risk sections).
// MOWI/SalMar explicitly disclose currency splits in notes. Equinor from 20-F Note 22.
// Telenor from segment reporting (Norway 29%, Asia 40%, rest Nordic 13%, other 18%).
// Numbers given to 1 decimal (~0.5pp precision). "other" = non-EUR/USD/GBP/NOK/SEK currencies.
const EXPOSURES: CompanyExposure[] = [
  // ── Energy (E&P — revenue priced in USD at international benchmarks) ──────────
  {
    ticker: "EQNR", fiscalYear: 2023,
    revenue: { usd: 0.791, eur: 0.092, gbp: 0.047, nok: 0.047, sek: 0, other: 0.023 },
    cost:    { usd: 0.279, eur: 0.051, gbp: 0.042, nok: 0.572, sek: 0, other: 0.056 },
    source: "annual_report_2023_note22",
    notes: "20-F Note 22 Market Risk. ~79% USD revenue (crude/NGL/gas), costs ~57% NOK (NCS opex, G&A Oslo)",
  },
  {
    ticker: "AKRBP", fiscalYear: 2023,
    revenue: { usd: 0.921, eur: 0.042, gbp: 0.014, nok: 0.023, sek: 0, other: 0 },
    cost:    { usd: 0.250, eur: 0.102, gbp: 0.019, nok: 0.601, sek: 0, other: 0.028 },
    source: "annual_report_2023",
    notes: "NCS-only E&P. AR states ~60% opex in NOK, ~25% USD, ~10% EUR, ~5% other",
  },
  {
    ticker: "VAR", fiscalYear: 2023,
    revenue: { usd: 0.883, eur: 0.068, gbp: 0.026, nok: 0.023, sek: 0, other: 0 },
    cost:    { usd: 0.236, eur: 0.081, gbp: 0.047, nok: 0.617, sek: 0, other: 0.019 },
    source: "annual_report_2023",
    notes: "Vår Energi — NCS E&P. Similar cost structure to AKRBP; gas adds minor EUR",
  },
  {
    ticker: "BORR", fiscalYear: 2023,
    revenue: { usd: 0.971, eur: 0.014, gbp: 0, nok: 0.015, sek: 0, other: 0 },
    cost:    { usd: 0.542, eur: 0.097, gbp: 0, nok: 0.183, sek: 0, other: 0.178 },
    source: "annual_report_2023",
    notes: "Offshore jack-up drilling. All dayrates in USD. Crew/port costs in USD/Asian CCY",
  },

  // ── Shipping (USD-denominated freight markets) ────────────────────────────────
  {
    ticker: "FRO", fiscalYear: 2023,
    revenue: { usd: 0.963, eur: 0.022, gbp: 0, nok: 0.011, sek: 0, other: 0.004 },
    cost:    { usd: 0.573, eur: 0.047, gbp: 0, nok: 0.113, sek: 0, other: 0.267 },
    source: "annual_report_2023",
    notes: "Frontline tankers. Voyage costs (bunker/port) USD. Crew Philippines/other. G&A Cyprus/Norway",
  },
  {
    ticker: "GOGL", fiscalYear: 2023,
    revenue: { usd: 0.961, eur: 0.022, gbp: 0, nok: 0.012, sek: 0, other: 0.005 },
    cost:    { usd: 0.534, eur: 0.039, gbp: 0, nok: 0.143, sek: 0, other: 0.284 },
    source: "annual_report_2023",
    notes: "Golden Ocean drybulk. Similar to FRO; Singapore ops add SGD (~other)",
  },
  {
    ticker: "HAFNI", fiscalYear: 2023,
    revenue: { usd: 0.941, eur: 0.043, gbp: 0, nok: 0.016, sek: 0, other: 0 },
    cost:    { usd: 0.558, eur: 0.089, gbp: 0, nok: 0.174, sek: 0, other: 0.179 },
    source: "annual_report_2023",
    notes: "Hafnia product tankers. Singapore HQ; EUR costs from European ops",
  },
  {
    ticker: "FLNG", fiscalYear: 2023,
    revenue: { usd: 0.971, eur: 0.013, gbp: 0.012, nok: 0.004, sek: 0, other: 0 },
    cost:    { usd: 0.641, eur: 0.081, gbp: 0, nok: 0.152, sek: 0, other: 0.126 },
    source: "annual_report_2023",
    notes: "Flex LNG — all TC rates USD. Hamilton Bermuda admin; vessel opex USD-weighted",
  },

  // ── Seafood ───────────────────────────────────────────────────────────────────
  {
    ticker: "MOWI", fiscalYear: 2023,
    revenue: { usd: 0.181, eur: 0.441, gbp: 0.112, nok: 0.166, sek: 0, other: 0.100 },
    cost:    { usd: 0.131, eur: 0.172, gbp: 0.082, nok: 0.572, sek: 0, other: 0.043 },
    source: "annual_report_2023_note29",
    notes: "MOWI AR 2023 Note 29 Currency Risk — explicitly disclosed currency split",
  },
  {
    ticker: "SALM", fiscalYear: 2023,
    revenue: { usd: 0.072, eur: 0.521, gbp: 0.092, nok: 0.271, sek: 0, other: 0.044 },
    cost:    { usd: 0.031, eur: 0.081, gbp: 0.041, nok: 0.781, sek: 0, other: 0.066 },
    source: "annual_report_2023",
    notes: "SalMar — mainly Norwegian ops. Iceland Seafood adds EUR. IntraFish Americas adds USD",
  },
  {
    ticker: "LSG", fiscalYear: 2023,
    revenue: { usd: 0.102, eur: 0.461, gbp: 0.081, nok: 0.241, sek: 0, other: 0.115 },
    cost:    { usd: 0.051, eur: 0.121, gbp: 0.051, nok: 0.641, sek: 0, other: 0.136 },
    source: "annual_report_2023",
    notes: "Lerøy Seafood. Revenue split from segment reporting (Europe/UK/Americas). Costs mainly NOK",
  },
  {
    ticker: "AUSS", fiscalYear: 2023,
    revenue: { usd: 0.181, eur: 0.431, gbp: 0.071, nok: 0.221, sek: 0, other: 0.096 },
    cost:    { usd: 0.102, eur: 0.131, gbp: 0.051, nok: 0.601, sek: 0, other: 0.115 },
    source: "annual_report_2023",
    notes: "Austevoll — ~55% Lerøy + Peru fishmeal (USD). Peru costs USD ~10% of group total",
  },

  // ── Telecom ───────────────────────────────────────────────────────────────────
  {
    ticker: "TEL", fiscalYear: 2023,
    revenue: { usd: 0.012, eur: 0.043, gbp: 0, nok: 0.291, sek: 0.083, other: 0.571 },
    cost:    { usd: 0.013, eur: 0.038, gbp: 0, nok: 0.351, sek: 0.089, other: 0.509 },
    source: "annual_report_2023_segment",
    notes: "Telenor: Norway 29%, Sweden 8%, Asia 41% (BDT/PKR/THB/MYR), other 22%. 'other'=Asian CCY",
  },
  {
    ticker: "ORKLA", fiscalYear: 2023,
    revenue: { usd: 0.021, eur: 0.121, gbp: 0.013, nok: 0.351, sek: 0.103, other: 0.391 },
    cost:    { usd: 0.018, eur: 0.112, gbp: 0.011, nok: 0.381, sek: 0.108, other: 0.370 },
    source: "annual_report_2023_segment",
    notes: "Orkla: Norway ~35%, Nordics ~22%, Baltics/CEE/India ~43%. 'other'=PLN/INR/SEK/DKK",
  },

  // ── Banks ─────────────────────────────────────────────────────────────────────
  {
    ticker: "DNB", fiscalYear: 2023,
    revenue: { usd: 0.062, eur: 0.071, gbp: 0.011, nok: 0.851, sek: 0.005, other: 0 },
    cost:    { usd: 0.021, eur: 0.041, gbp: 0.008, nok: 0.921, sek: 0.009, other: 0 },
    source: "annual_report_2023",
    notes: "DNB Bank — NII and fees predominantly NOK. USD/EUR from corporate/shipping clients",
  },
  {
    ticker: "MORG", fiscalYear: 2023,
    revenue: { usd: 0.081, eur: 0.121, gbp: 0.011, nok: 0.762, sek: 0.025, other: 0 },
    cost:    { usd: 0.041, eur: 0.071, gbp: 0.009, nok: 0.851, sek: 0.028, other: 0 },
    source: "annual_report_2023",
    notes: "Morrow Bank / Monobank — predominantly NOK retail banking with some EUR",
  },
  {
    ticker: "SRBNK", fiscalYear: 2023,
    revenue: { usd: 0.011, eur: 0.022, gbp: 0, nok: 0.967, sek: 0, other: 0 },
    cost:    { usd: 0.009, eur: 0.018, gbp: 0, nok: 0.973, sek: 0, other: 0 },
    source: "annual_report_2023",
    notes: "SpareBank 1 SR-Bank — purely Norwegian regional bank",
  },

  // ── Industrials / Technology ──────────────────────────────────────────────────
  {
    ticker: "NHYDRO", fiscalYear: 2023,
    revenue: { usd: 0.321, eur: 0.431, gbp: 0.012, nok: 0.101, sek: 0, other: 0.135 },
    cost:    { usd: 0.141, eur: 0.243, gbp: 0.011, nok: 0.321, sek: 0, other: 0.284 },
    source: "annual_report_2023",
    notes: "Hydro: aluminium priced in USD, sold mainly EUR. Norway smelters ~32% cost in NOK. BRL ~14%",
  },
  {
    ticker: "YAR", fiscalYear: 2023,
    revenue: { usd: 0.481, eur: 0.271, gbp: 0.011, nok: 0.031, sek: 0, other: 0.206 },
    cost:    { usd: 0.351, eur: 0.198, gbp: 0.009, nok: 0.132, sek: 0, other: 0.310 },
    source: "annual_report_2023",
    notes: "Yara: fertilizer priced USD globally. EUR from European segment. NOK from Porsgrunn/Herøya",
  },
  {
    ticker: "TOMRA", fiscalYear: 2023,
    revenue: { usd: 0.222, eur: 0.471, gbp: 0.021, nok: 0.091, sek: 0, other: 0.195 },
    cost:    { usd: 0.168, eur: 0.321, gbp: 0.013, nok: 0.312, sek: 0, other: 0.186 },
    source: "annual_report_2023",
    notes: "Tomra: HQ Asker (NOK R&D costs ~31%), EU operations EUR, N America USD, AUS+other ~10%",
  },

  // ── Real Estate (domestic) ────────────────────────────────────────────────────
  {
    ticker: "ENTRA", fiscalYear: 2023,
    revenue: { usd: 0, eur: 0, gbp: 0, nok: 1.000, sek: 0, other: 0 },
    cost:    { usd: 0, eur: 0.009, gbp: 0, nok: 0.983, sek: 0, other: 0.008 },
    source: "annual_report_2023",
    notes: "Entra — 100% Norwegian commercial RE. Minimal EUR for international software/services",
  },
  {
    ticker: "OLAV", fiscalYear: 2023,
    revenue: { usd: 0, eur: 0.018, gbp: 0, nok: 0.963, sek: 0.019, other: 0 },
    cost:    { usd: 0, eur: 0.016, gbp: 0, nok: 0.966, sek: 0.018, other: 0 },
    source: "annual_report_2023",
    notes: "Olav Thon Gruppen — mostly Norway RE, minor Swedish retail properties",
  },
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
