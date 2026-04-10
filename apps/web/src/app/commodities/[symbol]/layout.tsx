import type { Metadata } from "next";

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const s = symbol.toUpperCase();
  return {
    title: `${s} — Commodity Detail`,
    description: `Price history, moving averages, and stock sensitivity analysis for ${s}. Correlation to Oslo Børs equities.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
