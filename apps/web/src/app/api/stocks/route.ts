import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await supabase
    .from('stocks')
    .select('ticker,name,sector,currency,exchange,is_active')
    .order('ticker', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: 'DB query failed', details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ count: data?.length ?? 0, stocks: data ?? [] });
}
