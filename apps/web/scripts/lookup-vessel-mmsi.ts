/**
 * Resolve missing MMSIs using MyShipTracking vessel name search.
 * Searches by vessel name, extracts MMSI from result URLs, validates by IMO match.
 *
 * Run: npx tsx scripts/lookup-vessel-mmsi.ts [--dry-run] [--company=FRO]
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });
import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DRY_RUN = process.argv.includes("--dry-run");
const COMPANY = process.argv.find(a => a.startsWith("--company="))?.split("=")[1];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html",
};

async function lookupMST(vesselName: string, imo: string): Promise<string | null> {
  try {
    // Format name for URL: "Front Defender" → "FRONT+DEFENDER"
    const query = vesselName.toUpperCase().replace(/\s+/g, "+");
    const res = await fetch(`https://www.myshiptracking.com/vessels?name=${encodeURIComponent(query)}`, {
      headers: HEADERS, redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract all vessel links: href="/vessels/name-mmsi-XXXXXXXXX-imo-XXXXXXX"
    const links = html.matchAll(/href="\/vessels\/[^"]*mmsi-(\d+)-imo-(\d+)"/g);
    for (const m of links) {
      const mmsi = m[1];
      const foundImo = m[2];
      if (foundImo === imo) {
        return mmsi;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`=== MMSI Resolver (MyShipTracking) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  let query = `SELECT imo, vessel_name, company_ticker FROM shipping_vessels WHERE status = 'active' AND mmsi IS NULL`;
  const params: string[] = [];
  if (COMPANY) {
    query += ` AND company_ticker = $1`;
    params.push(COMPANY);
  }
  query += ` ORDER BY company_ticker, vessel_name`;

  const { rows: vessels } = await pool.query(query, params);
  console.log(`Vessels without MMSI: ${vessels.length}\n`);

  let resolved = 0, missed = 0;
  const updates: { imo: string; mmsi: string; name: string; company: string }[] = [];

  for (let i = 0; i < vessels.length; i++) {
    const v = vessels[i];
    const mmsi = await lookupMST(v.vessel_name, v.imo);

    if (mmsi) {
      resolved++;
      updates.push({ imo: v.imo, mmsi, name: v.vessel_name, company: v.company_ticker });
      console.log(`+ ${v.company_ticker.padEnd(10)} ${v.vessel_name.padEnd(24)} MMSI: ${mmsi}`);
    } else {
      missed++;
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  --- Progress: ${i + 1}/${vessels.length} (${resolved} found) ---`);
    }

    // Rate limit
    if (i < vessels.length - 1) {
      if ((i + 1) % 30 === 0) {
        await sleep(10000);
      } else {
        await sleep(2000);
      }
    }
  }

  console.log(`\nResolved: ${resolved}/${vessels.length}`);

  if (!DRY_RUN && updates.length > 0) {
    console.log("Writing to DB...");
    for (const u of updates) {
      await pool.query("UPDATE shipping_vessels SET mmsi = $1 WHERE imo = $2", [u.mmsi, u.imo]);
    }
    console.log(`Updated ${updates.length} vessels`);
  }

  await pool.end();
}

main().catch(console.error);
