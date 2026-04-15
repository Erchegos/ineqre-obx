import type { Metadata } from "next";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const t = ticker.toUpperCase();
  return {
    title: `${t} | ML Backtest Results`,
    description: `Factor-based ML backtest for ${t}. Cumulative return, hit rate, drawdown, and prediction accuracy analysis.`,
  };
}

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
