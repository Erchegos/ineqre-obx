import type { Metadata } from "next";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return {
    title: `${t} — Volatility & Regime Analysis`,
    description: `6-regime volatility classification, GARCH models, vol cone, VaR backtesting, and regime-specific trading signals for ${t}.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
