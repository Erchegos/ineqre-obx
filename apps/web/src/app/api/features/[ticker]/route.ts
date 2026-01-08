// apps/web/src/app/api/features/[ticker]/route.ts
import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { obxFeatures } from "@ineqre/db/schema";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await ctx.params;

    const url = new URL(req.url);
    const from = url.searchParams.get("from"); // YYYY-MM-DD
    const to = url.searchParams.get("to"); // YYYY-MM-DD
    const limitRaw = url.searchParams.get("limit");

    const limit = Math.min(Math.max(Number(limitRaw ?? 100) || 100, 1), 1000);

    const conditions = [
      eq(obxFeatures.ticker, ticker.toUpperCase()),
      from ? gte(obxFeatures.date, from) : undefined,
      to ? lte(obxFeatures.date, to) : undefined,
    ].filter(Boolean) as any[];

    const rows = await db
      .select({
        date: obxFeatures.date,
        ticker: obxFeatures.ticker,
        ret1d: obxFeatures.ret1d,
        vol20d: obxFeatures.vol20d,
      })
      .from(obxFeatures)
      .where(and(...conditions))
      .orderBy(asc(obxFeatures.date))
      .limit(limit);

    const latest = rows.length ? rows[rows.length - 1] : null;

    // Backward-compatible payload:
    // - rows: current canonical array
    // - features: alias for rows (common frontend expectation)
    // - latest: single latest row (common frontend expectation)
    // - snake_case aliases for consumers expecting DB column names
    const normalizedRows = rows.map((r) => ({
      ...r,
      ret_1d: r.ret1d,
      vol_20d: r.vol20d,
    }));

    const normalizedLatest = latest
      ? {
          ...latest,
          ret_1d: latest.ret1d,
          vol_20d: latest.vol20d,
        }
      : null;

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      count: normalizedRows.length,

      // canonical
      rows: normalizedRows,

      // compatibility aliases
      features: normalizedRows,
      latest: normalizedLatest,
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        message: e?.message ?? String(e),
        code: e?.code,
        detail: e?.detail,
        hint: e?.hint,
        where: e?.where,
      },
      { status: 500 }
    );
  }
}
