import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Backtest Results | ML Factor Strategy",
  description: "ML prediction backtesting across 200+ Oslo Børs stocks. Cumulative returns, hit rates, factor attribution, and per-ticker trade analysis.",
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
