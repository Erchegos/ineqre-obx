// apps/web/src/app/api/prices/[ticker]/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type PriceRow = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing env. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local'
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker: raw } = await ctx.params;

    const ticker = decodeURIComponent(raw || '').trim();
    if (!ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('prices_daily')
      .select('date, open, high, low, close, volume')
      .eq('ticker', ticker)
      .order('date', { ascending: true })
      .limit(5000);

    if (error) {
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 500 }
      );
    }

    const rows: PriceRow[] = (data ?? []).map((r: any) => ({
      date: r.date,
      open: r.open ?? null,
      high: r.high ?? null,
      low: r.low ?? null,
      close: r.close ?? null,
      volume: r.volume ?? null,
    }));

    return NextResponse.json(
      { ticker, count: rows.length, rows },
      {
        status: 200,
        headers: {
          // Avoid stale charts during development
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
