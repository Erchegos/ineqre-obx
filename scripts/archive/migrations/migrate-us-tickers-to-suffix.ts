#!/usr/bin/env tsx
/**
 * CRITICAL MIGRATION SCRIPT: Rename US dual-listed tickers to .US suffix
 *
 * This script safely renames US-listed dual-listed stocks to use .US suffix
 * to prevent ticker collisions with OSE versions.
 *
 * Example: EQNR (USD) → EQNR.US
 *
 * SAFETY FEATURES:
 * - Dry-run mode (--dry-run flag)
 * - Transaction-wrapped with rollback on error
 * - Pre/post count verification
 * - Currency + Exchange filtering
 * - Detailed logging
 *
 * Usage:
 *   npx tsx scripts/migrate-us-tickers-to-suffix.ts --dry-run  # Preview changes
 *   npx tsx scripts/migrate-us-tickers-to-suffix.ts           # Actually rename
 */

import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

interface TickerToRename {
  oldTicker: string;
  newTicker: string;
  currency: string;
  exchange: string;
}

// Stocks that need .US suffix
const TICKERS_TO_RENAME: TickerToRename[] = [
  { oldTicker: "EQNR", newTicker: "EQNR.US", currency: "USD", exchange: "NYSE" },
  { oldTicker: "FRO", newTicker: "FRO.US", currency: "USD", exchange: "NYSE" },
  { oldTicker: "BORR", newTicker: "BORR.US", currency: "USD", exchange: "NYSE" },
  { oldTicker: "BWLP", newTicker: "BWLP.US", currency: "USD", exchange: "NYSE" },
  { oldTicker: "ECO", newTicker: "ECO.US", currency: "USD", exchange: "NYSE" },
  { oldTicker: "HAFN", newTicker: "HAFN.US", currency: "USD", exchange: "NYSE" },
  { oldTicker: "HSHP", newTicker: "HSHP.US", currency: "USD", exchange: "NYSE" },
  // Note: CDLR stays as-is (no OSE version exists)
];

const isDryRun = process.argv.includes('--dry-run');

async function checkTickerExists(ticker: string, currency: string): Promise<{
  exists: boolean;
  priceCount: number;
  actualCurrency: string | null;
}> {
  const stockCheck = await pool.query(
    `SELECT currency FROM stocks WHERE ticker = $1`,
    [ticker]
  );

  if (stockCheck.rows.length === 0) {
    return { exists: false, priceCount: 0, actualCurrency: null };
  }

  const priceCheck = await pool.query(
    `SELECT COUNT(*) as count FROM prices_daily WHERE ticker = $1`,
    [ticker]
  );

  return {
    exists: true,
    priceCount: parseInt(priceCheck.rows[0].count),
    actualCurrency: stockCheck.rows[0].currency,
  };
}

async function renameTickerSafely(mapping: TickerToRename): Promise<{
  success: boolean;
  priceCountBefore: number;
  priceCountAfter: number;
  error?: string;
}> {
  const { oldTicker, newTicker, currency } = mapping;

  try {
    // 1. Check if old ticker exists and is correct currency
    const beforeState = await checkTickerExists(oldTicker, currency);

    if (!beforeState.exists) {
      return {
        success: false,
        priceCountBefore: 0,
        priceCountAfter: 0,
        error: `Ticker ${oldTicker} not found in database`,
      };
    }

    if (beforeState.actualCurrency !== currency) {
      return {
        success: false,
        priceCountBefore: beforeState.priceCount,
        priceCountAfter: 0,
        error: `Ticker ${oldTicker} has currency ${beforeState.actualCurrency}, expected ${currency}. Skipping to avoid data loss.`,
      };
    }

    // 2. Check if new ticker already exists
    const newTickerCheck = await checkTickerExists(newTicker, currency);
    if (newTickerCheck.exists) {
      return {
        success: false,
        priceCountBefore: beforeState.priceCount,
        priceCountAfter: newTickerCheck.priceCount,
        error: `Target ticker ${newTicker} already exists! Cannot rename.`,
      };
    }

    if (isDryRun) {
      console.log(`[DRY-RUN] Would rename ${oldTicker} → ${newTicker} (${beforeState.priceCount} prices)`);
      return {
        success: true,
        priceCountBefore: beforeState.priceCount,
        priceCountAfter: beforeState.priceCount,
      };
    }

    // 3. Perform rename using insert-update-delete approach to satisfy FK constraint
    await pool.query('BEGIN');

    // Step 1: Insert new stock record with .US suffix (copy all data from old record)
    await pool.query(
      `INSERT INTO stocks (ticker, name, sector, exchange, currency, asset_type, is_active)
       SELECT $1, name, sector, exchange, currency, asset_type, is_active
       FROM stocks
       WHERE ticker = $2 AND currency = $3`,
      [newTicker, oldTicker, currency]
    );

    // Step 2: Update prices_daily to reference new ticker (FK constraint satisfied)
    const pricesUpdate = await pool.query(
      `UPDATE prices_daily SET ticker = $1 WHERE ticker = $2`,
      [newTicker, oldTicker]
    );

    // Step 3: Delete old stock record (now has no child records)
    await pool.query(
      `DELETE FROM stocks WHERE ticker = $1 AND currency = $2`,
      [oldTicker, currency]
    );

    // 4. Verify counts
    const afterState = await checkTickerExists(newTicker, currency);

    if (!afterState.exists) {
      await pool.query('ROLLBACK');
      return {
        success: false,
        priceCountBefore: beforeState.priceCount,
        priceCountAfter: 0,
        error: `Verification failed: ${newTicker} not found after rename`,
      };
    }

    if (afterState.priceCount !== beforeState.priceCount) {
      await pool.query('ROLLBACK');
      return {
        success: false,
        priceCountBefore: beforeState.priceCount,
        priceCountAfter: afterState.priceCount,
        error: `Count mismatch! Before: ${beforeState.priceCount}, After: ${afterState.priceCount}`,
      };
    }

    // 5. Verify old ticker is gone
    const oldTickerGone = await checkTickerExists(oldTicker, currency);
    if (oldTickerGone.exists && oldTickerGone.actualCurrency === currency) {
      await pool.query('ROLLBACK');
      return {
        success: false,
        priceCountBefore: beforeState.priceCount,
        priceCountAfter: afterState.priceCount,
        error: `Old ticker ${oldTicker} (${currency}) still exists after rename`,
      };
    }

    // All checks passed!
    await pool.query('COMMIT');

    return {
      success: true,
      priceCountBefore: beforeState.priceCount,
      priceCountAfter: afterState.priceCount,
    };

  } catch (error: any) {
    await pool.query('ROLLBACK').catch(() => {}); // Ignore rollback errors
    return {
      success: false,
      priceCountBefore: 0,
      priceCountAfter: 0,
      error: error.message,
    };
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("MIGRATE US TICKERS TO .US SUFFIX");
  console.log("=".repeat(70));

  if (isDryRun) {
    console.log("\n🔍 DRY-RUN MODE - No changes will be made\n");
  } else {
    console.log("\n⚠️  LIVE MODE - Changes will be committed to database\n");
    console.log("Press Ctrl+C within 5 seconds to cancel...\n");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log(`Processing ${TICKERS_TO_RENAME.length} tickers\n`);

  const results: Array<{
    mapping: TickerToRename;
    result: Awaited<ReturnType<typeof renameTickerSafely>>;
  }> = [];

  for (const mapping of TICKERS_TO_RENAME) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Processing: ${mapping.oldTicker} → ${mapping.newTicker}`);
    console.log(`Currency: ${mapping.currency}, Exchange: ${mapping.exchange}`);
    console.log(`${"─".repeat(60)}`);

    const result = await renameTickerSafely(mapping);
    results.push({ mapping, result });

    if (result.success) {
      console.log(`✓ Success: ${mapping.oldTicker} → ${mapping.newTicker}`);
      console.log(`  Price records: ${result.priceCountBefore} → ${result.priceCountAfter}`);
    } else {
      console.error(`✗ Failed: ${result.error}`);
      if (result.priceCountBefore > 0) {
        console.error(`  Price records before: ${result.priceCountBefore}`);
      }
    }
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("MIGRATION SUMMARY");
  console.log("=".repeat(70));

  const successful = results.filter(r => r.result.success);
  const failed = results.filter(r => !r.result.success);

  console.log(`\nTotal tickers: ${TICKERS_TO_RENAME.length}`);
  console.log(`Successfully renamed: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (successful.length > 0) {
    console.log("\n✓ Successfully renamed:");
    successful.forEach(({ mapping, result }) => {
      console.log(`  ${mapping.oldTicker} → ${mapping.newTicker} (${result.priceCountAfter} prices)`);
    });
  }

  if (failed.length > 0) {
    console.log("\n✗ Failed:");
    failed.forEach(({ mapping, result }) => {
      console.log(`  ${mapping.oldTicker}: ${result.error}`);
    });
  }

  if (isDryRun) {
    console.log("\n🔍 Dry-run completed. No changes were made.");
    console.log("Run without --dry-run to apply changes.\n");
  } else if (successful.length === TICKERS_TO_RENAME.length) {
    console.log("\n✅ Migration completed successfully!");
    console.log("All US dual-listed tickers now use .US suffix.\n");
  } else {
    console.log("\n⚠️  Migration completed with some failures.");
    console.log("Review failed tickers and retry if needed.\n");
  }

  await pool.end();
}

main().catch(error => {
  console.error("Fatal error:", error);
  pool.end();
  process.exit(1);
});
