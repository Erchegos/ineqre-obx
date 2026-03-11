/**
 * Ocean Temperature Fetcher — MET Norway Oceanforecast API
 *
 * Fetches sea water temperature for all 13 Norwegian salmon production areas
 * using the free MET Norway Oceanforecast 2.0 API (no auth required).
 *
 * The API provides hourly forecasts (~8 days ahead) based on the Norkyst 800m
 * ocean model. We take the latest observation and store weekly averages.
 *
 * Source: https://api.met.no/weatherapi/oceanforecast/2.0/
 * Terms: https://api.met.no/doc/TermsOfService (free, requires User-Agent)
 *
 * Run: npx tsx scripts/fetch-ocean-temps-met.ts
 * Options:
 *   --dry-run   Print but don't insert
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

const USER_AGENT = "InEqRe/1.0 github.com/Erchegos/ineqre-obx";

// Representative coastal coordinates per production area.
// Uses average salmon farm positions from seafood_localities,
// with manual adjustments where the ocean model has no coverage (Area 1 Skagerrak).
const AREA_COORDS: { area: number; name: string; lat: number; lon: number }[] = [
  { area: 1,  name: "Svenskegrensen til Jæren",  lat: 58.10, lon: 6.50 },   // adjusted west (Skagerrak coast)
  { area: 2,  name: "Ryfylke",                   lat: 59.55, lon: 5.96 },
  { area: 3,  name: "Karmøy til Sotra",          lat: 59.97, lon: 5.35 },
  { area: 4,  name: "Nordhordland til Stadt",     lat: 60.99, lon: 5.13 },
  { area: 5,  name: "Stadt til Hustadvika",       lat: 62.21, lon: 6.00 },
  { area: 6,  name: "Nordmøre og Sør-Trøndelag", lat: 63.09, lon: 8.55 },
  { area: 7,  name: "Nord-Trøndelag med Bindal",  lat: 64.46, lon: 11.07 },
  { area: 8,  name: "Helgeland til Bodø",         lat: 66.29, lon: 12.99 },
  { area: 9,  name: "Vestfjorden og Vesterålen",  lat: 68.14, lon: 14.90 },
  { area: 10, name: "Andøya til Senja",           lat: 68.76, lon: 16.75 },
  { area: 11, name: "Kvaløya til Loppa",          lat: 69.74, lon: 19.18 },
  { area: 12, name: "Vest-Finnmark",              lat: 70.41, lon: 23.26 },
  { area: 13, name: "Øst-Finnmark",               lat: 70.50, lon: 27.00 },  // adjusted west (model coverage)
];

interface TempReading {
  area: number;
  name: string;
  temp: number;
  time: string;
  waveHeight: number | null;
  waterSpeed: number | null;
}

async function fetchAreaTemperature(
  area: number,
  name: string,
  lat: number,
  lon: number
): Promise<TempReading | null> {
  const url = `https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=${lat}&lon=${lon}`;

  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!resp.ok) {
      console.error(`  Area ${area} (${name}): HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const ts = data.properties?.timeseries;

    if (!ts || ts.length === 0) {
      const err = data.properties?.meta?.error;
      console.warn(`  Area ${area} (${name}): No data — ${err || "empty timeseries"}`);
      return null;
    }

    // Take the most recent (first) entry
    const latest = ts[0];
    const details = latest.data?.instant?.details;
    const temp = details?.sea_water_temperature;

    if (temp == null) {
      console.warn(`  Area ${area} (${name}): No temperature in response`);
      return null;
    }

    return {
      area,
      name,
      temp: Math.round(temp * 100) / 100,
      time: latest.time,
      waveHeight: details?.sea_surface_wave_height ?? null,
      waterSpeed: details?.sea_water_speed ?? null,
    };
  } catch (err: any) {
    console.error(`  Area ${area} (${name}): ${err.message}`);
    return null;
  }
}

function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  MET Norway Ocean Temperature Fetcher");
  console.log("═══════════════════════════════════════════════════\n");
  console.log(`  Source: api.met.no/weatherapi/oceanforecast/2.0`);
  console.log(`  Areas:  ${AREA_COORDS.length}`);
  console.log(`  Dry run: ${DRY_RUN}\n`);

  const readings: TempReading[] = [];

  for (const ac of AREA_COORDS) {
    const reading = await fetchAreaTemperature(ac.area, ac.name, ac.lat, ac.lon);
    if (reading) {
      readings.push(reading);
      console.log(
        `  Area ${String(ac.area).padStart(2)}: ${reading.temp.toFixed(1)}°C  (${ac.name})` +
          (reading.waveHeight != null ? `  waves=${reading.waveHeight}m` : "")
      );
    }
    // Rate limit: MET asks for max 20 req/sec, we'll be gentle
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n  ${readings.length}/${AREA_COORDS.length} areas with temperature data\n`);

  if (readings.length === 0) {
    console.log("No readings — nothing to store.");
    await pool.end();
    return;
  }

  // Current ISO week
  const now = new Date();
  const { year, week } = getISOWeek(now);
  console.log(`  Storing as ${year}-W${String(week).padStart(2, "0")}\n`);

  // Calculate min/max/avg across all areas (for logging)
  const temps = readings.map((r) => r.temp);
  const avgAll = temps.reduce((a, b) => a + b, 0) / temps.length;
  console.log(
    `  National: avg=${avgAll.toFixed(1)}°C, min=${Math.min(...temps).toFixed(1)}°C, max=${Math.max(...temps).toFixed(1)}°C\n`
  );

  if (DRY_RUN) {
    console.log("  [DRY RUN] Would upsert into seafood_ocean_conditions:");
    for (const r of readings) {
      console.log(`    Area ${r.area}: ${r.temp}°C (week ${year}-W${week})`);
    }
    await pool.end();
    return;
  }

  // Upsert into seafood_ocean_conditions
  let upserted = 0;
  for (const r of readings) {
    await pool.query(
      `INSERT INTO seafood_ocean_conditions
        (area_number, year, week, avg_sea_temp, min_sea_temp, max_sea_temp, reporting_sites)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (area_number, year, week) DO UPDATE SET
         avg_sea_temp = EXCLUDED.avg_sea_temp,
         min_sea_temp = EXCLUDED.min_sea_temp,
         max_sea_temp = EXCLUDED.max_sea_temp,
         reporting_sites = EXCLUDED.reporting_sites`,
      [r.area, year, week, r.temp, r.temp, r.temp, 1]
    );
    upserted++;
  }

  console.log(`  Upserted ${upserted} rows into seafood_ocean_conditions\n`);

  // Also update the lice_reports sea_temperature for this week
  // This backfills the field that BarentsWatch no longer provides
  let liceUpdated = 0;
  for (const r of readings) {
    const result = await pool.query(
      `UPDATE seafood_lice_reports lr
       SET sea_temperature = $1
       FROM seafood_localities sl
       WHERE lr.locality_id = sl.locality_id
         AND sl.production_area_number = $2
         AND lr.year = $3 AND lr.week = $4
         AND lr.sea_temperature IS NULL`,
      [r.temp, r.area, year, week]
    );
    liceUpdated += result.rowCount || 0;
  }
  if (liceUpdated > 0) {
    console.log(`  Backfilled ${liceUpdated} lice_reports with MET temperatures\n`);
  }

  console.log("Done.");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
