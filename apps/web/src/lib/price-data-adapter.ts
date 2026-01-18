// apps/web/src/lib/price-data-adapter.ts
import { pool } from "./db";

let cachedTableName: string | null = null;

/**
 * Detects which price table exists and caches the result
 * Returns 'prices_daily' or 'obx_equities'
 */
async function detectPriceTable(): Promise<string> {
  if (cachedTableName) {
    return cachedTableName;
  }

  try {
    // Check if prices_daily exists
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'prices_daily'
      ) as has_prices_daily,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'obx_equities'
      ) as has_obx_equities
    `);

    const { has_prices_daily, has_obx_equities } = result.rows[0];

    if (has_prices_daily) {
      cachedTableName = "prices_daily";
    } else if (has_obx_equities) {
      cachedTableName = "obx_equities";
    } else {
      throw new Error("No price data table found (prices_daily or obx_equities)");
    }

    console.log(`[Price Data Adapter] Using table: ${cachedTableName}`);
    return cachedTableName;
  } catch (e) {
    console.error("Failed to detect price table:", e);
    // Fallback if detection fails (e.g. permission issues), usually safe to default to standard
    return "prices_daily";
  }
}

/**
 * Get the correct price table name for current environment
 */
export async function getPriceTable(): Promise<string> {
  return await detectPriceTable();
}

/**
 * Build query with correct table name
 */
export async function buildPriceQuery(
  selectClause: string,
  whereClause: string = "",
  orderClause: string = "",
  limitClause: string = ""
): Promise<string> {
  const tableName = await getPriceTable();
  
  let query = `SELECT ${selectClause} FROM public.${tableName}`;
  
  if (whereClause) {
    query += ` WHERE ${whereClause}`;
  }
  
  if (orderClause) {
    query += ` ORDER BY ${orderClause}`;
  }
  
  if (limitClause) {
    query += ` LIMIT ${limitClause}`;
  }
  
  return query;
}