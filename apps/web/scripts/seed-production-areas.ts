/**
 * Seed Norwegian Aquaculture Production Areas
 *
 * Seeds the 13 production areas with current traffic light status.
 * Traffic light decisions from Nærings- og fiskeridepartementet (2024 decision).
 *
 * Run: npx tsx scripts/seed-production-areas.ts
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

// 13 Norwegian aquaculture production areas
// Traffic light status from 2024 decision (effective 2024-2026)
// Capacity change: green = +6%, yellow = 0%, red = -6%
const PRODUCTION_AREAS = [
  {
    areaNumber: 1,
    name: "Svenskegrensen til Jæren",
    trafficLight: "green",
    decisionDate: "2024-02-01",
    capacityChangePct: 6,
    centerLat: 58.5,
    centerLng: 6.5,
    notes: "Southernmost area, minimal salmon farming",
  },
  {
    areaNumber: 2,
    name: "Ryfylke",
    trafficLight: "yellow",
    decisionDate: "2024-02-01",
    capacityChangePct: 0,
    centerLat: 59.3,
    centerLng: 5.8,
    notes: "Rogaland fjords, moderate lice pressure",
  },
  {
    areaNumber: 3,
    name: "Karmøy til Sotra",
    trafficLight: "red",
    decisionDate: "2024-02-01",
    capacityChangePct: -6,
    centerLat: 59.7,
    centerLng: 5.2,
    notes: "Hardangerfjorden area, high lice impact on wild salmon",
  },
  {
    areaNumber: 4,
    name: "Nordhordland til Stadt",
    trafficLight: "red",
    decisionDate: "2024-02-01",
    capacityChangePct: -6,
    centerLat: 61.0,
    centerLng: 5.0,
    notes: "Sognefjorden area, significant lice pressure",
  },
  {
    areaNumber: 5,
    name: "Stadt til Hustadvika",
    trafficLight: "yellow",
    decisionDate: "2024-02-01",
    capacityChangePct: 0,
    centerLat: 62.2,
    centerLng: 5.5,
    notes: "Møre og Romsdal coast",
  },
  {
    areaNumber: 6,
    name: "Nordmøre og Sør-Trøndelag",
    trafficLight: "green",
    decisionDate: "2024-02-01",
    capacityChangePct: 6,
    centerLat: 63.3,
    centerLng: 8.5,
    notes: "Trondheimsleia area",
  },
  {
    areaNumber: 7,
    name: "Nord-Trøndelag med Bindal",
    trafficLight: "green",
    decisionDate: "2024-02-01",
    capacityChangePct: 6,
    centerLat: 64.5,
    centerLng: 11.0,
    notes: "Namsen fjord area",
  },
  {
    areaNumber: 8,
    name: "Helgeland til Bodø",
    trafficLight: "green",
    decisionDate: "2024-02-01",
    capacityChangePct: 6,
    centerLat: 66.5,
    centerLng: 13.5,
    notes: "Southern Nordland",
  },
  {
    areaNumber: 9,
    name: "Vestfjorden og Vesterålen",
    trafficLight: "yellow",
    decisionDate: "2024-02-01",
    capacityChangePct: 0,
    centerLat: 68.2,
    centerLng: 14.5,
    notes: "Lofoten and Vesterålen",
  },
  {
    areaNumber: 10,
    name: "Andøya til Senja",
    trafficLight: "green",
    decisionDate: "2024-02-01",
    capacityChangePct: 6,
    centerLat: 69.0,
    centerLng: 16.5,
    notes: "Northern Troms coast",
  },
  {
    areaNumber: 11,
    name: "Kvaløya til Loppa",
    trafficLight: "green",
    decisionDate: "2024-02-01",
    capacityChangePct: 6,
    centerLat: 69.8,
    centerLng: 18.5,
    notes: "Tromsø area",
  },
  {
    areaNumber: 12,
    name: "Vest-Finnmark",
    trafficLight: "green",
    decisionDate: "2024-02-01",
    capacityChangePct: 6,
    centerLat: 70.5,
    centerLng: 23.5,
    notes: "Alta and Hammerfest area",
  },
  {
    areaNumber: 13,
    name: "Øst-Finnmark",
    trafficLight: "green",
    decisionDate: "2024-02-01",
    capacityChangePct: 6,
    centerLat: 70.5,
    centerLng: 28.0,
    notes: "Easternmost area, Varanger",
  },
];

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Seeding Norwegian Production Areas");
  console.log("═══════════════════════════════════════════════════\n");

  let inserted = 0;
  let updated = 0;

  for (const area of PRODUCTION_AREAS) {
    const result = await pool.query(
      `INSERT INTO seafood_production_areas
        (area_number, name, traffic_light, decision_date, capacity_change_pct,
         center_lat, center_lng, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (area_number) DO UPDATE SET
         name = EXCLUDED.name,
         traffic_light = EXCLUDED.traffic_light,
         decision_date = EXCLUDED.decision_date,
         capacity_change_pct = EXCLUDED.capacity_change_pct,
         center_lat = EXCLUDED.center_lat,
         center_lng = EXCLUDED.center_lng,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING (xmax = 0) AS is_insert`,
      [
        area.areaNumber,
        area.name,
        area.trafficLight,
        area.decisionDate,
        area.capacityChangePct,
        area.centerLat,
        area.centerLng,
        area.notes,
      ]
    );

    const isInsert = result.rows[0]?.is_insert;
    const icon = area.trafficLight === "green" ? "🟢" : area.trafficLight === "yellow" ? "🟡" : "🔴";
    console.log(
      `  ${icon} Area ${area.areaNumber}: ${area.name} (${area.trafficLight}) — ${isInsert ? "inserted" : "updated"}`
    );

    if (isInsert) inserted++;
    else updated++;
  }

  console.log(`\n  Inserted: ${inserted}, Updated: ${updated}`);
  console.log(`  Total production areas: ${PRODUCTION_AREAS.length}\n`);

  // Also seed mock company metrics for v1 display
  console.log("Seeding mock company metrics...\n");
  const today = new Date().toISOString().slice(0, 10);
  const companies = [
    { ticker: "MOWI", name: "Mowi ASA", areas: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], sites: 95, avgLice: 0.18, pctAbove: 8, treatRate: 1.2, seaTemp: 8.5, risk: 32 },
    { ticker: "SALM", name: "SalMar ASA", areas: [6, 7, 8, 10, 11], sites: 55, avgLice: 0.14, pctAbove: 5, treatRate: 0.9, seaTemp: 8.0, risk: 25 },
    { ticker: "LSG", name: "Lerøy Seafood Group ASA", areas: [3, 4, 6, 7, 8, 10], sites: 60, avgLice: 0.22, pctAbove: 12, treatRate: 1.5, seaTemp: 8.2, risk: 38 },
    { ticker: "GSF", name: "Grieg Seafood ASA", areas: [2, 3, 11, 12], sites: 30, avgLice: 0.25, pctAbove: 15, treatRate: 1.8, seaTemp: 8.8, risk: 45 },
    { ticker: "BAKKA", name: "Bakkafrost ASA", areas: [6, 7], sites: 18, avgLice: 0.12, pctAbove: 3, treatRate: 0.6, seaTemp: 7.5, risk: 18 },
    { ticker: "AUSS", name: "Austevoll Seafood ASA", areas: [3, 4, 5], sites: 25, avgLice: 0.20, pctAbove: 10, treatRate: 1.3, seaTemp: 8.6, risk: 35 },
  ];

  for (const co of companies) {
    await pool.query(
      `INSERT INTO seafood_company_metrics
        (ticker, company_name, as_of_date, active_sites, avg_lice_4w,
         pct_above_threshold, treatment_rate, avg_sea_temp, risk_score, production_areas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (ticker, as_of_date) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         active_sites = EXCLUDED.active_sites,
         avg_lice_4w = EXCLUDED.avg_lice_4w,
         pct_above_threshold = EXCLUDED.pct_above_threshold,
         treatment_rate = EXCLUDED.treatment_rate,
         avg_sea_temp = EXCLUDED.avg_sea_temp,
         risk_score = EXCLUDED.risk_score,
         production_areas = EXCLUDED.production_areas`,
      [co.ticker, co.name, today, co.sites, co.avgLice, co.pctAbove, co.treatRate, co.seaTemp, co.risk, JSON.stringify(co.areas)]
    );
    console.log(`  ${co.ticker}: ${co.name} (${co.sites} sites, avg lice: ${co.avgLice})`);
  }

  console.log("\nDone.");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
