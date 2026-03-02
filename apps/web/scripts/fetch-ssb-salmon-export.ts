/**
 * SSB Salmon Export Price Fetcher
 *
 * Fetches weekly Norwegian salmon export price (NOK/kg) and volume (tonnes)
 * from Statistics Norway (SSB) PxWebApi v2 — Table 03024.
 *
 * No authentication required. Free public API.
 *
 * Run: npx tsx scripts/fetch-ssb-salmon-export.ts
 * Options:
 *   --dry-run   Print but don't insert
 *   --weeks=52  Limit to last N weeks (default: all available)
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const dbUrl = (process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const pool = new Pool({ connectionString: dbUrl });

const DRY_RUN = process.argv.includes("--dry-run");
const WEEKS_LIMIT = parseInt(
  process.argv.find((a) => a.startsWith("--weeks="))?.split("=")[1] ?? "0"
);

// SSB PxWebApi v2 endpoint for table 03024 (salmon export)
const SSB_API_URL =
  "https://data.ssb.no/api/v0/no/table/03024";

// JSON-stat query body for table 03024
// Fetches: all weeks, fresh+frozen salmon, price + volume
function buildQuery() {
  return {
    query: [
      {
        code: "VareGrupper2",
        selection: {
          filter: "item",
          values: ["01", "02"] // 01 = Fresh, 02 = Frozen
        }
      },
      {
        code: "ContentsCode",
        selection: {
          filter: "item",
          values: ["Kilopris", "Vekt"] // Price NOK/kg and Weight (tonnes)
        }
      }
    ],
    response: {
      format: "json-stat2"
    }
  };
}

interface WeekData {
  weekStart: string; // Monday date "YYYY-MM-DD"
  priceNokKg: number | null;
  volumeTonnes: number | null;
  category: string;
}

/**
 * Convert SSB week code "YYYYUww" to Monday date
 * SSB uses ISO week numbering
 */
function weekCodeToDate(code: string): string | null {
  // Format: "2024U01" = year 2024, week 01
  const match = code.match(/^(\d{4})U(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1]);
  const week = parseInt(match[2]);

  // ISO 8601: Week 1 contains January 4th
  // Find Monday of the given ISO week
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // Mon=1, Sun=7
  const monday1 = new Date(jan4);
  monday1.setDate(jan4.getDate() - dayOfWeek + 1); // Monday of week 1

  const targetMonday = new Date(monday1);
  targetMonday.setDate(monday1.getDate() + (week - 1) * 7);

  const yyyy = targetMonday.getFullYear();
  const mm = String(targetMonday.getMonth() + 1).padStart(2, "0");
  const dd = String(targetMonday.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  console.log("=== SSB Salmon Export Price Fetcher ===\n");

  // 1) Fetch data from SSB
  console.log("Fetching from SSB PxWebApi (table 03024) ...");
  const resp = await fetch(SSB_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildQuery()),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SSB API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();

  // 2) Parse JSON-stat2 response
  // JSON-stat2 has: dimension, id, size, value (flat array)
  const dimensions = data.dimension;
  const vals: (number | null)[] = data.value;
  const dimIds: string[] = data.id;   // e.g. ["VareGrupper2", "ContentsCode", "Tid"]
  const sizes: number[] = data.size;  // e.g. [2, 2, N_weeks]

  console.log(`  Dimensions: ${dimIds.join(", ")}`);
  console.log(`  Sizes: ${sizes.join(" x ")}`);

  // Category maps
  const vareDim = dimensions["VareGrupper2"];
  const contentsDim = dimensions["ContentsCode"];
  const timeDim = dimensions["Tid"];

  const vareKeys = Object.keys(vareDim.category.index);   // ["01","02"]
  const contKeys = Object.keys(contentsDim.category.index); // ["Kilopris","Vekt"]
  const timeKeys = Object.keys(timeDim.category.index);     // ["2000U01",...]

  const nVare = sizes[dimIds.indexOf("VareGrupper2")];
  const nCont = sizes[dimIds.indexOf("ContentsCode")];
  const nTime = sizes[dimIds.indexOf("Tid")];

  console.log(`  VareGrupper: ${vareKeys.join(", ")} (${nVare})`);
  console.log(`  Contents: ${contKeys.join(", ")} (${nCont})`);
  console.log(`  Time periods: ${nTime}`);

  // Map category labels
  const categoryMap: Record<string, string> = { "01": "fresh", "02": "frozen" };

  // Flat index = v * (nCont * nTime) + c * nTime + t
  const priceContIdx = contentsDim.category.index["Kilopris"] ?? 0;
  const volContIdx = contentsDim.category.index["Vekt"] ?? 1;

  const weeklyData: WeekData[] = [];

  for (let v = 0; v < nVare; v++) {
    const cat = categoryMap[vareKeys[v]] || "all";
    for (let t = 0; t < nTime; t++) {
      const weekCode = timeKeys[t];
      const weekStart = weekCodeToDate(weekCode);
      if (!weekStart) continue;

      const priceIdx = v * (nCont * nTime) + priceContIdx * nTime + t;
      const volIdx = v * (nCont * nTime) + volContIdx * nTime + t;

      const priceVal = vals[priceIdx];
      const volVal = vals[volIdx];

      weeklyData.push({
        weekStart,
        priceNokKg: priceVal != null ? priceVal : null,
        volumeTonnes: volVal != null ? volVal : null,
        category: cat,
      });
    }
  }

  // Also compute "all" category (sum fresh+frozen volume, weighted avg price)
  const weekMap = new Map<string, { totalVol: number; totalVal: number }>();
  for (const w of weeklyData) {
    if (w.priceNokKg == null && w.volumeTonnes == null) continue;
    let agg = weekMap.get(w.weekStart);
    if (!agg) { agg = { totalVol: 0, totalVal: 0 }; weekMap.set(w.weekStart, agg); }
    const vol = w.volumeTonnes || 0;
    const price = w.priceNokKg || 0;
    agg.totalVol += vol;
    agg.totalVal += price * vol;
  }
  for (const [ws, agg] of weekMap) {
    weeklyData.push({
      weekStart: ws,
      priceNokKg: agg.totalVol > 0 ? Math.round((agg.totalVal / agg.totalVol) * 100) / 100 : null,
      volumeTonnes: agg.totalVol > 0 ? agg.totalVol : null,
      category: "all",
    });
  }

  // Apply weeks limit
  let filtered = weeklyData.filter(
    (w) => w.priceNokKg !== null || w.volumeTonnes !== null
  );
  if (WEEKS_LIMIT > 0) {
    filtered = filtered.slice(-WEEKS_LIMIT);
  }

  console.log(`  Valid data points: ${filtered.length}\n`);

  if (filtered.length === 0) {
    console.log("No data to insert.");
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    console.log("DRY RUN — last 10 data points:");
    for (const w of filtered.slice(-10)) {
      console.log(
        `  ${w.weekStart} | price=${w.priceNokKg?.toFixed(2)} NOK/kg | vol=${w.volumeTonnes?.toFixed(0)} t`
      );
    }
    await pool.end();
    return;
  }

  // 3) Upsert into seafood_export_weekly
  console.log("Upserting into seafood_export_weekly ...");

  const BATCH_SIZE = 100;
  let totalUpserted = 0;

  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: (string | number | null)[] = [];
    let pIdx = 1;

    for (const w of batch) {
      values.push(`($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3})`);
      params.push(w.weekStart, w.priceNokKg, w.volumeTonnes, w.category);
      pIdx += 4;
    }

    const sql = `
      INSERT INTO seafood_export_weekly (week_start, price_nok_kg, volume_tonnes, category)
      VALUES ${values.join(",\n")}
      ON CONFLICT (week_start, category) DO UPDATE SET
        price_nok_kg = EXCLUDED.price_nok_kg,
        volume_tonnes = EXCLUDED.volume_tonnes
    `;

    const result = await pool.query(sql, params);
    totalUpserted += result.rowCount || 0;
  }

  console.log(`  Upserted ${totalUpserted} rows`);

  // 4) Summary
  const summary = await pool.query(`
    SELECT category, COUNT(*) as weeks,
           MIN(week_start) as from_week, MAX(week_start) as to_week,
           ROUND(AVG(price_nok_kg::numeric), 2) as avg_price
    FROM seafood_export_weekly
    GROUP BY category
    ORDER BY category
  `);
  console.log("\nSummary:");
  for (const r of summary.rows) {
    console.log(
      `  ${r.category}: ${r.weeks} weeks, ${r.from_week} → ${r.to_week}, avg price=${r.avg_price} NOK/kg`
    );
  }

  await pool.end();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
