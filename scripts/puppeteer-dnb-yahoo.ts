#!/usr/bin/env tsx
/**
 * Fetch DNB Historical Data from Yahoo Finance using Puppeteer
 *
 * Yahoo Finance loads data with JavaScript, so we need a headless browser
 * to render the page and extract the table data
 */
import { Pool } from "pg";
import puppeteer from "puppeteer";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

interface YahooBar {
  date: string; // YYYYMMDD format
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose: number;
}

async function getExistingDates(): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT to_char(date, 'YYYYMMDD') as date_str
     FROM prices_daily
     WHERE ticker = 'DNB'
     ORDER BY date ASC`
  );

  return new Set(result.rows.map(row => row.date_str));
}

async function scrapeYahooDataWithPuppeteer(): Promise<YahooBar[]> {
  const url = 'https://finance.yahoo.com/quote/DNB.OL/history?period1=946684800&period2=1769773200&interval=1d&filter=history&frequency=1d&includeAdjustedClose=true';

  console.log('Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    console.log('Loading Yahoo Finance page...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('Waiting for table to load...');
    await page.waitForSelector('table tbody tr', { timeout: 30000 });

    // Scroll to load more data (lazy loading)
    console.log('Scrolling to load all data...');
    let previousHeight = 0;
    let scrollAttempts = 0;
    const maxScrolls = 50; // Limit scrolls to prevent infinite loop

    while (scrollAttempts < maxScrolls) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);

      if (currentHeight === previousHeight) {
        break; // No more content loading
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for content to load

      previousHeight = currentHeight;
      scrollAttempts++;
    }

    console.log(`Scrolled ${scrollAttempts} times to load data`);

    console.log('Extracting table data...');
    const bars = await page.evaluate(() => {
      const results: YahooBar[] = [];
      const rows = document.querySelectorAll('table tbody tr');

      const months: Record<string, string> = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
      };

      rows.forEach((row) => {
        const cells = row.querySelectorAll('td');

        if (cells.length >= 7) {
          const dateText = cells[0].textContent?.trim() || '';
          const openText = cells[1].textContent?.trim() || '';
          const highText = cells[2].textContent?.trim() || '';
          const lowText = cells[3].textContent?.trim() || '';
          const closeText = cells[4].textContent?.trim() || '';
          const adjCloseText = cells[5].textContent?.trim() || '';
          const volumeText = cells[6].textContent?.trim() || '';

          // Skip invalid rows
          if (dateText === '-' || openText === '-' || dateText === '') {
            return;
          }

          // Parse date from "Jan 30, 2026" format to YYYYMMDD
          const dateParts = dateText.match(/(\w+)\s+(\d+),\s+(\d+)/);
          if (!dateParts) {
            return;
          }

          const month = months[dateParts[1]];
          const day = dateParts[2].padStart(2, '0');
          const year = dateParts[3];
          const date = `${year}${month}${day}`;

          // Parse numbers (remove commas)
          const open = parseFloat(openText.replace(/,/g, ''));
          const high = parseFloat(highText.replace(/,/g, ''));
          const low = parseFloat(lowText.replace(/,/g, ''));
          const close = parseFloat(closeText.replace(/,/g, ''));
          const adjClose = parseFloat(adjCloseText.replace(/,/g, ''));
          const volume = parseInt(volumeText.replace(/,/g, ''));

          if (!isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close) && !isNaN(adjClose) && !isNaN(volume)) {
            results.push({ date, open, high, low, close, adjClose, volume });
          }
        }
      });

      return results;
    });

    return bars;

  } finally {
    await browser.close();
  }
}

async function insertPriceData(ticker: string, bar: YahooBar) {
  await pool.query(
    `INSERT INTO prices_daily (ticker, date, open, high, low, close, volume, adj_close, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'yahoo')
     ON CONFLICT (ticker, date, source) DO UPDATE SET
       open = EXCLUDED.open,
       high = EXCLUDED.high,
       low = EXCLUDED.low,
       close = EXCLUDED.close,
       volume = EXCLUDED.volume,
       adj_close = EXCLUDED.adj_close`,
    [
      ticker,
      bar.date,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      Math.round(bar.volume),
      bar.adjClose,
    ]
  );
}

async function main() {
  console.log("=".repeat(70));
  console.log("FETCH DNB HISTORICAL DATA FROM YAHOO FINANCE (PUPPETEER)");
  console.log("=".repeat(70));
  console.log("\nUsing headless browser to scrape dynamically loaded data\n");

  try {
    // Step 1: Get existing dates from database
    console.log("[1/4] Loading existing DNB dates from database...");
    const existingDates = await getExistingDates();
    console.log(`✓ Found ${existingDates.size} existing dates in database\n`);

    // Step 2: Scrape data from Yahoo Finance
    console.log("[2/4] Scraping DNB.OL data from Yahoo Finance...");
    const result = await scrapeYahooDataWithPuppeteer();

    console.log(`✓ Scraped ${result.length} bars from Yahoo Finance`);

    if (result.length === 0) {
      console.log("✗ No data found. Page structure may have changed.");
      return;
    }

    const firstDate = result[0].date.slice(0, 4) + '-' + result[0].date.slice(4, 6) + '-' + result[0].date.slice(6, 8);
    const lastDate = result[result.length - 1].date.slice(0, 4) + '-' + result[result.length - 1].date.slice(4, 6) + '-' + result[result.length - 1].date.slice(6, 8);
    console.log(`  Date range: ${firstDate} to ${lastDate}\n`);

    // Step 3: Filter out dates that already exist
    console.log("[3/4] Filtering data...");
    const newBars = result.filter(bar => !existingDates.has(bar.date));

    console.log(`✓ Found ${newBars.length} new dates to insert`);
    console.log(`  (${existingDates.size} dates already exist from IBKR)\n`);

    if (newBars.length === 0) {
      console.log("✓ No new data to insert. Database is up to date.");
      return;
    }

    // Step 4: Insert new data
    console.log("[4/4] Inserting new data into database...");
    console.log(`Inserting ${newBars.length} price records from Yahoo Finance...\n`);

    let inserted = 0;
    for (let i = 0; i < newBars.length; i++) {
      const bar = newBars[i];
      await insertPriceData('DNB', bar);
      inserted++;

      if ((i + 1) % 500 === 0) {
        console.log(`  Progress: ${i + 1}/${newBars.length} rows inserted...`);
      }
    }

    console.log(`\n✓ Database update complete!`);
    console.log(`  New records inserted: ${inserted}`);
    console.log(`  Source: Yahoo Finance (yahoo)`);

    // Get final statistics
    const statsResult = await pool.query(
      `SELECT
         COUNT(*) as total_rows,
         MIN(date) as start_date,
         MAX(date) as end_date,
         COUNT(DISTINCT source) as sources
       FROM prices_daily
       WHERE ticker = 'DNB'`
    );

    const stats = statsResult.rows[0];
    const startDate = stats.start_date.toISOString().slice(0, 10);
    const endDate = stats.end_date.toISOString().slice(0, 10);
    const yearsOfHistory = ((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 365)).toFixed(1);

    console.log("\n" + "=".repeat(70));
    console.log("UPDATED DNB METRICS");
    console.log("=".repeat(70));
    console.log(`Start Date: ${startDate}`);
    console.log(`End Date: ${endDate}`);
    console.log(`Total Rows: ${stats.total_rows}`);
    console.log(`Years of History: ${yearsOfHistory} years`);
    console.log(`Data Sources: ${stats.sources} (IBKR + Yahoo Finance)`);

    console.log("\n✓ DNB historical data successfully extended!");
    console.log("\nNext steps:");
    console.log("1. Refresh the stocks page to see updated metrics");
    console.log("2. Verify DNB now shows improved data tier");
    console.log("3. Check data quality completeness percentage");

  } catch (error: any) {
    console.error("\n✗ Fatal error:", error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
    console.log("\n✓ Disconnected from database");
  }
}

main();
